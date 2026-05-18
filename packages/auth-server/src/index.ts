/**
 * Minimal OAuth client for Google Sign-In.
 *
 * Three endpoints:
 *   GET /auth/google/login    -> 302 to Google's /authorize
 *   GET /auth/google/callback -> exchange code for tokens, mint session, redirect to web
 *   GET /auth/google/me       -> return { email, name, sub } for the current session, or 401
 *
 * v1 simplifications (intentional):
 *   - Sessions live in an in-memory Map; restarting the server logs everyone out.
 *   - No PKCE: this is a confidential client (we hold a real client_secret).
 *   - No id_token signature verification: we trust TLS to Google for now.
 *   - Cookie expiry is the only session lifetime (no server-side expiresAt).
 *   - No /logout, no /refresh, no userinfo call.
 */

import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { Hono } from "hono";
import { getCookie, setCookie } from "hono/cookie";

// ----- Secrets loading -----
//
// Real OAuth credentials live OUTSIDE the repo at ~/.thoth/local-secrets.env.
// This keeps them off disk in any directory that might be tarballed, synced,
// or screen-shared. Format is plain KEY=value lines (same as a .env file).
// Values here always win over anything already set in process.env -- this file
// is the canonical source of truth for local secrets.
const SECRETS_PATH = join(homedir(), ".thoth", "local-secrets.env");
if (existsSync(SECRETS_PATH)) {
  for (const line of readFileSync(SECRETS_PATH, "utf8").split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq < 0) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    process.env[key] = value;
  }
  console.log(`[auth-server] loaded secrets from ${SECRETS_PATH}`);
} else {
  console.warn(
    `[auth-server] secrets file not found at ${SECRETS_PATH} -- required() checks will fail unless env vars are set another way`,
  );
}

// ----- Config -----

const env = Bun.env;
// Only the two credentials are required from the secrets file.
// Everything else is config with sensible local-dev defaults; override
// via env if you ever need to (different port, different web origin, etc.).
const GOOGLE_CLIENT_ID = required("GOOGLE_CLIENT_ID");
const GOOGLE_CLIENT_SECRET = required("GOOGLE_CLIENT_SECRET");
const PORT = Number(env.PORT ?? 8788);
const GOOGLE_REDIRECT_URI =
  env.GOOGLE_REDIRECT_URI ?? `http://localhost:${PORT}/auth/google/callback`;
const WEB_ORIGIN = env.WEB_ORIGIN ?? "http://localhost:5173";

function required(name: string): string {
  const v = Bun.env[name];
  if (!v) throw new Error(`Missing required env var: ${name}`);
  return v;
}

// ----- Session store -----

type SessionUser = {
  sub: string;
  email: string;
  name?: string;
  picture?: string;
};

const sessions = new Map<string, SessionUser>();

const STATE_COOKIE = "oauth_state";
const SESSION_COOKIE = "sid";
const STATE_TTL_SECONDS = 10 * 60; // 10 minutes for the round-trip to Google
const SESSION_TTL_SECONDS = 24 * 60 * 60; // 1 day

// ----- App -----

const app = new Hono();

/**
 * Kick off the OAuth flow.
 * 1. Generate a random `state` so we can detect cross-site / replay shenanigans on the callback.
 * 2. Stash it in an httpOnly cookie (SameSite=Lax so it survives the top-level redirect back from Google).
 * 3. 302 the browser to Google's /authorize with our client_id, redirect_uri, scopes, and the state.
 */
app.get("/auth/google/login", (c) => {
  const state = crypto.randomUUID();

  setCookie(c, STATE_COOKIE, state, {
    httpOnly: true,
    sameSite: "Lax",
    path: "/",
    maxAge: STATE_TTL_SECONDS,
    // secure: false  -- localhost runs over http; browsers allow non-Secure cookies on localhost
  });

  const authorize = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  authorize.searchParams.set("client_id", GOOGLE_CLIENT_ID);
  authorize.searchParams.set("redirect_uri", GOOGLE_REDIRECT_URI);
  authorize.searchParams.set("response_type", "code");
  authorize.searchParams.set("scope", "openid email profile");
  authorize.searchParams.set("state", state);
  // Force account chooser every time during development; remove for production UX.
  authorize.searchParams.set("prompt", "select_account");

  return c.redirect(authorize.toString(), 302);
});

/**
 * Google redirects the browser back here after the user consents:
 *   GET /auth/google/callback?code=...&state=...
 *
 * 1. Verify the `state` query matches the cookie we set in /login. If not, abort.
 * 2. Back-channel POST to Google's token endpoint with code + client_secret to swap code -> tokens.
 * 3. Decode the id_token's payload (no signature verification in v1) to get sub/email/name.
 * 4. Mint a fresh sid, store user in the in-memory map, set sid cookie, redirect to the web origin.
 *
 * We deliberately throw away access_token / refresh_token / raw id_token -- we only need identity.
 */
app.get("/auth/google/callback", async (c) => {
  const url = new URL(c.req.url);
  const code = url.searchParams.get("code");
  const stateFromQuery = url.searchParams.get("state");
  const stateFromCookie = getCookie(c, STATE_COOKIE);

  // Always clear the state cookie -- single-use.
  setCookie(c, STATE_COOKIE, "", { path: "/", maxAge: 0 });

  if (!code) return c.text("Missing code", 400);
  if (!stateFromQuery || !stateFromCookie || stateFromQuery !== stateFromCookie) {
    return c.text("Invalid state", 400);
  }

  // --- Exchange code for tokens (back channel: server <-> Google directly) ---
  const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: GOOGLE_CLIENT_ID,
      client_secret: GOOGLE_CLIENT_SECRET,
      redirect_uri: GOOGLE_REDIRECT_URI,
      grant_type: "authorization_code",
    }),
  });

  if (!tokenRes.ok) {
    const body = await tokenRes.text();
    console.error("Token exchange failed:", tokenRes.status, body);
    return c.text("Token exchange failed", 502);
  }

  const tokens = (await tokenRes.json()) as { id_token?: string };
  if (!tokens.id_token) return c.text("No id_token in response", 502);

  // --- Decode id_token claims (skipping signature verification for v1) ---
  const claims = decodeJwtPayload(tokens.id_token) as {
    sub: string;
    email: string;
    name?: string;
    picture?: string;
    email_verified?: boolean;
  };

  // --- Mint our own session ---
  const sid = crypto.randomUUID();
  sessions.set(sid, {
    sub: claims.sub,
    email: claims.email,
    name: claims.name,
    picture: claims.picture,
  });

  setCookie(c, SESSION_COOKIE, sid, {
    httpOnly: true,
    sameSite: "Lax",
    path: "/",
    maxAge: SESSION_TTL_SECONDS,
  });

  // TODO: once the SPA's /login page exists, redirect to WEB_ORIGIN instead.
  // For now, bounce to /me so you can see the session was minted without needing the SPA running.
  return c.redirect("/auth/google/me", 302);
});

/**
 * Look up the current session by sid cookie. Used by the SPA on load to decide
 * whether to render the app or bounce to /login.
 */
app.get("/auth/google/me", (c) => {
  const sid = getCookie(c, SESSION_COOKIE);
  if (!sid) return c.json({ error: "not authenticated" }, 401);

  const user = sessions.get(sid);
  if (!user) return c.json({ error: "not authenticated" }, 401);

  return c.json({ email: user.email, name: user.name, picture: user.picture });
});

// ----- Helpers -----

/**
 * Decode the payload section of a JWT (the middle part between the two dots).
 * NOTE: this does not verify the signature -- for v1 we trust that TLS to Google
 * means the id_token we just received over a back-channel POST is authentic.
 * When we deploy, swap this for `jose` and verify against Google's JWKS.
 */
function decodeJwtPayload(jwt: string): unknown {
  const parts = jwt.split(".");
  if (parts.length !== 3) throw new Error("Malformed JWT");
  let b64 = parts[1].replace(/-/g, "+").replace(/_/g, "/");
  while (b64.length % 4) b64 += "=";
  const bin = atob(b64);
  const bytes = Uint8Array.from(bin, (ch) => ch.charCodeAt(0));
  return JSON.parse(new TextDecoder().decode(bytes));
}

// ----- Boot -----

console.log(`[auth-server] listening on http://localhost:${PORT}`);
console.log(`[auth-server] redirect URI: ${GOOGLE_REDIRECT_URI}`);
console.log(`[auth-server] web origin:   ${WEB_ORIGIN}`);

export default {
  port: PORT,
  fetch: app.fetch,
};
