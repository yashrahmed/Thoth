import { createRemoteJWKSet, jwtVerify, type JWTPayload, type JWTVerifyGetKey } from "jose";
import type { AccessConfig } from "../../../config/config";
import type { AccessIdentity, AccessIdentityVerifier, AccessVerificationResult } from "../../../domain/contracts/access-identity-verifier";

export class AccessJwtVerificationService implements AccessIdentityVerifier {
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
    const email = typeof payload.email === "string" ? payload.email : "";

    if (email) {
      return { type: "user", sub, email };
    }

    const commonName = typeof payload.common_name === "string" ? payload.common_name : "";

    if (commonName) {
      return { type: "service-token", sub, serviceTokenClientId: commonName };
    }

    return { type: "unknown", sub };
  }
}
