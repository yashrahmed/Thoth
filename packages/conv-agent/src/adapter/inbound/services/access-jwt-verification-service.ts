import { createRemoteJWKSet, jwtVerify, type JWTPayload, type JWTVerifyGetKey } from "jose";
import type { AccessConfig } from "../../../config/config";

export interface AccessIdentity {
  readonly sub: string;
  readonly email: string;
}

export type AccessVerificationResult =
  | { readonly ok: true; readonly identity: AccessIdentity }
  | { readonly ok: false; readonly reason: string };

export class AccessJwtVerificationService {
  private readonly getKey: JWTVerifyGetKey;

  constructor(private readonly config: AccessConfig) {
    this.getKey = createRemoteJWKSet(new URL(`${config.teamDomain}/cdn-cgi/access/certs`));
  }

  async verify(token: string): Promise<AccessVerificationResult> {
    try {
      const { payload } = await jwtVerify(token, this.getKey, {
        issuer: this.config.teamDomain,
        audience: this.config.aud,
      });

      return { ok: true, identity: this.extractIdentity(payload) };
    } catch (error) {
      const reason = error instanceof Error ? error.message : "invalid token";
      return { ok: false, reason };
    }
  }

  private extractIdentity(payload: JWTPayload): AccessIdentity {
    const sub = typeof payload.sub === "string" ? payload.sub : "";
    // User logins carry `email`; service-token logins carry `common_name`.
    const email =
      typeof payload.email === "string"
        ? payload.email
        : typeof payload.common_name === "string"
          ? payload.common_name
          : "";

    return { sub, email };
  }
}
