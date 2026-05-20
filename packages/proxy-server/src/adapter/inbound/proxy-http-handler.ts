import { Hono } from "hono";
import { getCookie, setCookie } from "hono/cookie";
import type { ProxyServerConfig, SessionStore, SessionUser } from "../../config/config";

interface ProxyHttpHandlerDeps {
  readonly config: ProxyServerConfig;
  readonly sessions: SessionStore;
}

const STATE_COOKIE = "oauth_state";
const SESSION_COOKIE = "sid";
const STATE_TTL_SECONDS = 10 * 60;
const SESSION_TTL_SECONDS = 24 * 60 * 60;
const PUBLIC_PATHS = new Set(["/", "/health"]);
const HOP_BY_HOP_HEADERS = new Set([
  "connection",
  "content-length",
  "host",
  "keep-alive",
  "proxy-authenticate",
  "proxy-authorization",
  "te",
  "trailer",
  "trailers",
  "transfer-encoding",
  "upgrade",
]);

export function createProxyHttpHandler(deps: ProxyHttpHandlerDeps): (req: Request) => Response | Promise<Response> {
  const app = new Hono();
  const { config, sessions } = deps;

  app.get("/", (c) => c.json({ name: "proxy-server", status: "ok" }));
  app.get("/health", (c) => c.json({ status: "ok", service: "proxy-server" }));

  app.get("/auth/google/login", (c) => {
    const state = crypto.randomUUID();

    setCookie(c, STATE_COOKIE, state, {
      httpOnly: true,
      sameSite: "Lax",
      path: "/",
      maxAge: STATE_TTL_SECONDS,
      secure: isHttps(c.req.url),
    });

    const authorize = new URL("https://accounts.google.com/o/oauth2/v2/auth");
    authorize.searchParams.set("client_id", config.googleClientId);
    authorize.searchParams.set("redirect_uri", resolveGoogleRedirectUri(config, c.req.url));
    authorize.searchParams.set("response_type", "code");
    authorize.searchParams.set("scope", "openid email profile");
    authorize.searchParams.set("state", state);
    authorize.searchParams.set("prompt", "select_account");

    return c.redirect(authorize.toString(), 302);
  });

  app.get("/auth/google/callback", async (c) => {
    const url = new URL(c.req.url);
    const code = url.searchParams.get("code");
    const stateFromQuery = url.searchParams.get("state");
    const stateFromCookie = getCookie(c, STATE_COOKIE);

    setCookie(c, STATE_COOKIE, "", { path: "/", maxAge: 0, secure: isHttps(c.req.url) });

    if (!code) return c.text("Missing code", 400);
    if (!stateFromQuery || !stateFromCookie || stateFromQuery !== stateFromCookie) {
      return c.text("Invalid state", 400);
    }

    const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        code,
        client_id: config.googleClientId,
        client_secret: config.googleClientSecret,
        redirect_uri: resolveGoogleRedirectUri(config, c.req.url),
        grant_type: "authorization_code",
      }),
    });

    if (!tokenRes.ok) {
      const body = await tokenRes.text();
      console.error("[proxy-server] token exchange failed", { status: tokenRes.status, body });
      return c.text("Token exchange failed", 502);
    }

    const tokens = (await tokenRes.json()) as { readonly id_token?: string };
    if (!tokens.id_token) return c.text("No id_token in response", 502);

    const claims = decodeJwtPayload(tokens.id_token) as {
      readonly sub: string;
      readonly email: string;
      readonly name?: string;
      readonly picture?: string;
    };

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
      secure: isHttps(c.req.url),
    });

    return c.redirect(config.webOrigin, 302);
  });

  app.get("/auth/google/me", (c) => {
    const user = getSessionUser(c.req.raw, sessions);
    if (!user) return c.json({ error: "not authenticated" }, 401);

    return c.json({ email: user.email, name: user.name, picture: user.picture });
  });

  app.post("/auth/logout", (c) => {
    const sid = getCookie(c, SESSION_COOKIE);
    if (sid) {
      sessions.delete(sid);
    }

    setCookie(c, SESSION_COOKIE, "", { path: "/", maxAge: 0, secure: isHttps(c.req.url) });
    return c.body(null, 204);
  });

  app.all("*", async (c) => {
    if (PUBLIC_PATHS.has(c.req.path)) {
      return c.json({ name: "proxy-server", status: "ok" });
    }

    const user = getSessionUser(c.req.raw, sessions);
    if (!user) {
      return c.json(
        {
          error: {
            kind: "UnauthorizedError",
            message: "Missing or invalid session.",
          },
        },
        401,
      );
    }

    return proxyToConvAgent(c.req.raw, config);
  });

  return (req: Request) => app.fetch(req);
}

function getSessionUser(request: Request, sessions: SessionStore): SessionUser | undefined {
  const sid = getCookieValue(request.headers.get("cookie") ?? "", SESSION_COOKIE);
  if (!sid) return undefined;

  return sessions.get(sid);
}

async function proxyToConvAgent(request: Request, config: ProxyServerConfig): Promise<Response> {
  const targetUrl = buildTargetUrl(request.url, config.convAgentUrl);
  const headers = buildProxyRequestHeaders(request.headers, config.backendBearerToken);
  const body = request.method === "GET" || request.method === "HEAD" ? undefined : request.body;
  const requestInit: RequestInit & { duplex?: "half" } = {
    method: request.method,
    headers,
    body,
    redirect: "manual",
  };

  if (body) {
    requestInit.duplex = "half";
  }

  const upstreamResponse = await fetch(targetUrl, requestInit);

  return new Response(upstreamResponse.body, {
    status: upstreamResponse.status,
    statusText: upstreamResponse.statusText,
    headers: upstreamResponse.headers,
  });
}

function buildTargetUrl(requestUrl: string, convAgentUrl: string): string {
  const incomingUrl = new URL(requestUrl);
  const baseUrl = new URL(convAgentUrl.endsWith("/") ? convAgentUrl : `${convAgentUrl}/`);
  const targetUrl = new URL(`${incomingUrl.pathname.slice(1)}${incomingUrl.search}`, baseUrl);

  return targetUrl.toString();
}

function buildProxyRequestHeaders(incomingHeaders: Headers, backendBearerToken: string): Headers {
  const headers = new Headers(incomingHeaders);

  for (const headerName of HOP_BY_HOP_HEADERS) {
    headers.delete(headerName);
  }

  headers.delete("authorization");
  headers.delete("cookie");
  headers.set("authorization", `Bearer ${backendBearerToken}`);

  return headers;
}

function resolveGoogleRedirectUri(config: ProxyServerConfig, requestUrl: string): string {
  if (config.googleRedirectUri) {
    return config.googleRedirectUri;
  }

  const url = new URL(requestUrl);
  return `${url.origin}/auth/google/callback`;
}

function decodeJwtPayload(jwt: string): unknown {
  const parts = jwt.split(".");
  if (parts.length !== 3) throw new Error("Malformed JWT");

  let b64 = parts[1].replace(/-/g, "+").replace(/_/g, "/");
  while (b64.length % 4) b64 += "=";

  const bin = atob(b64);
  const bytes = Uint8Array.from(bin, (ch) => ch.charCodeAt(0));

  return JSON.parse(new TextDecoder().decode(bytes));
}

function getCookieValue(cookieHeader: string, name: string): string | undefined {
  for (const cookiePart of cookieHeader.split(";")) {
    const [rawName, ...rawValueParts] = cookiePart.trim().split("=");
    if (rawName !== name) continue;

    return rawValueParts.join("=");
  }

  return undefined;
}

function isHttps(url: string): boolean {
  return new URL(url).protocol === "https:";
}
