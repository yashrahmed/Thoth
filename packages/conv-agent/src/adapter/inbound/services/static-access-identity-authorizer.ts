import type { AuthConfig } from "../../../config/config";
import type { AccessIdentityAuthorizer } from "../../../domain/contracts/access-identity-authorizer";
import type { AccessIdentity } from "../../../domain/contracts/access-identity-verifier";

export class StaticAccessIdentityAuthorizer implements AccessIdentityAuthorizer {
  private readonly allowedUserEmails: ReadonlySet<string>;
  private readonly allowedServiceTokenClientIds: ReadonlySet<string>;

  constructor(config: AuthConfig) {
    this.allowedUserEmails = new Set(normalizeValues(config.allowedUserEmails).map((email) => email.toLowerCase()));
    this.allowedServiceTokenClientIds = new Set(normalizeValues(config.allowedServiceTokenClientIds));
  }

  async isAuthorized(identity: AccessIdentity): Promise<boolean> {
    if (identity.type === "user") {
      return typeof identity.email === "string" && this.allowedUserEmails.has(identity.email.toLowerCase());
    }

    if (identity.type === "service-token") {
      return typeof identity.serviceTokenClientId === "string" && this.allowedServiceTokenClientIds.has(identity.serviceTokenClientId);
    }

    return false;
  }
}

function normalizeValues(values: ReadonlyArray<string>): ReadonlyArray<string> {
  return values.map((value) => value.trim()).filter((value) => value.length > 0);
}
