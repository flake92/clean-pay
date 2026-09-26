type VerifiedAccessToken = {
  sid: string;
  uid: string;
  exp: number;
  al?: "BOOTSTRAP" | "FULL";
  ev?: boolean;
  tg?: boolean;
};

export type WebAccessCredentialState =
  | { kind: "missing" }
  | { kind: "invalid" }
  | { kind: "valid"; payload: VerifiedAccessToken };

export function resolveWebAccessCredential(
  accessToken: string | undefined,
  verify: (token: string) => VerifiedAccessToken | null,
): WebAccessCredentialState {
  if (!accessToken) {
    return { kind: "missing" };
  }

  const payload = verify(accessToken);
  return payload
    ? { kind: "valid", payload }
    : { kind: "invalid" };
}

export function getWebSessionExpiryWindow(
  now: Date,
  accessSessionTtlMinutes: number,
  refreshSessionTtlDays: number,
) {
  return {
    accessTokenExpiresAt: getWebSessionAccessExpiry(
      now,
      accessSessionTtlMinutes,
    ),
    refreshExpiresAt: new Date(
      now.getTime() + refreshSessionTtlDays * 24 * 60 * 60 * 1000,
    ),
  };
}

export function getWebSessionAccessExpiry(now: Date, ttlMinutes: number) {
  return new Date(now.getTime() + ttlMinutes * 60 * 1000);
}

export function getWebSessionRevocationSource(
  hasValidAccessCredential: boolean,
  hasRefreshCredential: boolean,
) {
  return hasValidAccessCredential
    ? "access"
    : hasRefreshCredential
      ? "refresh"
      : "cookies_only";
}

export function revokedWebSessionData(now: Date) {
  return {
    revokedAt: now,
    accessTokenExpiresAt: now,
    refreshExpiresAt: now,
    remnashopAccessTokenEncrypted: null,
    remnashopRefreshTokenEncrypted: null,
    remnashopAccessExpiresAt: null,
    remnashopRefreshExpiresAt: null,
    remnashopRefreshClaimTokenHash: null,
    remnashopRefreshLeaseExpiresAt: null,
    remnashopRefreshDispatchedAt: null,
    remnashopRefreshRecoveryEncrypted: null,
  };
}
