export interface ProxyServerConfig {
  readonly googleClientId: string;
  readonly googleClientSecret: string;
  readonly backendBearerToken: string;
  readonly convAgentUrl: string;
  readonly googleRedirectUri?: string;
  readonly webOrigin: string;
}

export interface SessionUser {
  readonly sub: string;
  readonly email: string;
  readonly name?: string;
  readonly picture?: string;
}

export type SessionStore = Map<string, SessionUser>;
