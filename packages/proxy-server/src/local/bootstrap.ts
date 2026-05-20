import { createProxyHttpHandler } from "../adapter/inbound/proxy-http-handler";
import type { ProxyServerConfig, SessionStore } from "../config/config";

export interface LocalEnv {
  readonly GOOGLE_CLIENT_ID?: string;
  readonly GOOGLE_CLIENT_SECRET?: string;
  readonly TEMP_BEARER_TOKEN?: string;
  readonly CONV_AGENT_URL?: string;
  readonly GOOGLE_REDIRECT_URI?: string;
  readonly WEB_ORIGIN?: string;
}

interface LocalDeps {
  readonly httpHandler: (request: Request) => Response | Promise<Response>;
  readonly config: ProxyServerConfig;
}

export function buildLocalDeps(env: LocalEnv, sessions: SessionStore): LocalDeps {
  const config = buildConfig(env);

  return {
    config,
    httpHandler: createProxyHttpHandler({
      config,
      sessions,
    }),
  };
}

function buildConfig(env: LocalEnv): ProxyServerConfig {
  return {
    googleClientId: requireString(env.GOOGLE_CLIENT_ID, "GOOGLE_CLIENT_ID"),
    googleClientSecret: requireString(env.GOOGLE_CLIENT_SECRET, "GOOGLE_CLIENT_SECRET"),
    backendBearerToken: requireString(env.TEMP_BEARER_TOKEN, "TEMP_BEARER_TOKEN"),
    convAgentUrl: optionalString(env.CONV_AGENT_URL) ?? "http://127.0.0.1:3001",
    googleRedirectUri: optionalString(env.GOOGLE_REDIRECT_URI),
    webOrigin: optionalString(env.WEB_ORIGIN) ?? "http://localhost:5173",
  };
}

function requireString(value: string | undefined, name: string): string {
  const trimmed = value?.trim();
  if (!trimmed) throw new Error(`Missing required env var: ${name}`);

  return trimmed;
}

function optionalString(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}
