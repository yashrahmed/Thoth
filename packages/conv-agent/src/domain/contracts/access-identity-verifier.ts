export interface AccessIdentity {
  readonly type: "user" | "service-token" | "unknown";
  // Keep the JWT subject so future persistence can key users by issuer-stable identity instead of mutable email.
  readonly sub: string;
  readonly email?: string;
  readonly serviceTokenClientId?: string;
}

export type AccessVerificationResult = { readonly ok: true; readonly identity: AccessIdentity } | { readonly ok: false; readonly reason: string };

export interface AccessIdentityVerifier {
  verify(token: string): Promise<AccessVerificationResult>;
}
