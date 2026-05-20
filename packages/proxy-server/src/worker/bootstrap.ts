import { createProxyHttpHandler } from "../adapter/inbound/proxy-http-handler";
import type { ProxyServerConfig, SessionStore } from "../config/config";

export interface WorkerEnv {
  readonly GOOGLE_CLIENT_ID: string;
  readonly GOOGLE_CLIENT_SECRET: string;
  readonly TEMP_BEARER_TOKEN: string;
  readonly CONV_AGENT_URL: string;
  readonly GOOGLE_REDIRECT_URI?: string;
  readonly WEB_ORIGIN?: string;
}

interface WorkerDeps {
  readonly httpHandler: (request: Request) => Response | Promise<Response>;
}

export function buildWorkerDeps(env: WorkerEnv, sessions: SessionStore): WorkerDeps {
  return {
    httpHandler: createProxyHttpHandler({
      config: buildConfig(env),
      sessions,
    }),
  };
}

function buildConfig(env: WorkerEnv): ProxyServerConfig {
  return {
    googleClientId: requireString(env.GOOGLE_CLIENT_ID, "GOOGLE_CLIENT_ID"),
    googleClientSecret: requireString(env.GOOGLE_CLIENT_SECRET, "GOOGLE_CLIENT_SECRET"),
    backendBearerToken: requireString(env.TEMP_BEARER_TOKEN, "TEMP_BEARER_TOKEN"),
    convAgentUrl: requireString(env.CONV_AGENT_URL, "CONV_AGENT_URL"),
    googleRedirectUri: optionalString(env.GOOGLE_REDIRECT_URI),
    webOrigin: optionalString(env.WEB_ORIGIN) ?? "/",
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
