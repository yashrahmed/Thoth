import type { AccessIdentity } from "./access-identity-verifier";

export interface AccessIdentityAuthorizer {
  isAuthorized(identity: AccessIdentity): Promise<boolean>;
}
