import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { buildLocalDeps } from "./bootstrap";
import type { SessionStore } from "../config/config";

const SECRETS_PATH = join(homedir(), ".thoth", "local-secrets.env");
const sessions: SessionStore = new Map();

loadSecretsFile(SECRETS_PATH);

const PORT = Number(Bun.env.PORT ?? 8788);
const deps = buildLocalDeps(
  {
    GOOGLE_CLIENT_ID: Bun.env.GOOGLE_CLIENT_ID,
    GOOGLE_CLIENT_SECRET: Bun.env.GOOGLE_CLIENT_SECRET,
    TEMP_BEARER_TOKEN: Bun.env.TEMP_BEARER_TOKEN,
    CONV_AGENT_URL: Bun.env.CONV_AGENT_URL,
    GOOGLE_REDIRECT_URI: Bun.env.GOOGLE_REDIRECT_URI,
    WEB_ORIGIN: Bun.env.WEB_ORIGIN,
  },
  sessions,
);

console.log(`[proxy-server] listening on http://localhost:${PORT}`);
console.log(`[proxy-server] conv-agent target: ${deps.config.convAgentUrl}`);
console.log(`[proxy-server] web origin:        ${deps.config.webOrigin}`);

export default {
  port: PORT,
  fetch: deps.httpHandler,
};

function loadSecretsFile(path: string): void {
  if (!existsSync(path)) {
    console.warn(`[proxy-server] secrets file not found at ${path} -- required env vars must be set another way`);
    return;
  }

  for (const line of readFileSync(path, "utf8").split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;

    const eq = trimmed.indexOf("=");
    if (eq < 0) continue;

    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }

    process.env[key] = value;
  }

  console.log(`[proxy-server] loaded secrets from ${path}`);
}
