import type { Prisma } from "@prisma/client";

import { ServiceError } from "@/backend/errors/service-error";
import { sha256 } from "@/backend/security/crypto";

export type RefreshResult = {
  data: {
    expires_at: string;
    refresh_expires_at: string;
  };
  cookies: {
    accessToken: string;
    refreshToken: string;
  };
};

export type LockedSession = Prisma.WebSessionGetPayload<{
  include: { user: true };
}>;

export type TokenCandidate = {
  session: LockedSession;
  accessToken: string;
  refreshToken: string;
};

export type PreparedTokenCandidate = TokenCandidate & {
  rewrap: {
    accessTokenEncrypted: string;
    refreshTokenEncrypted: string;
    data: {
      remnashopAccessTokenEncrypted: string;
      remnashopRefreshTokenEncrypted: string;
    };
  } | null;
};

export type TokenResult = TokenCandidate & {
  source: "stored" | "refresh";
};

export type RefreshRecovery = {
  version: 1;
  accessToken: string;
  refreshToken: string;
  accessExpiresAt: string;
  refreshExpiresAt: string;
};

export type RefreshPlan = {
  session: LockedSession;
  refreshToken: string;
  previousRefreshTokenEncrypted: string;
  claimTokenHash: string;
  leaseExpiresAt: Date;
};

export type DispatchedRefreshPlan = RefreshPlan & { dispatchedAt: Date };

export type Preparation =
  | { kind: "result"; result: TokenResult | null }
  | { kind: "refresh"; plan: RefreshPlan }
  | { kind: "wait"; retryAfterSeconds: number };

export const clearedTokenBundle = {
  remnashopAccessTokenEncrypted: null,
  remnashopRefreshTokenEncrypted: null,
  remnashopAccessExpiresAt: null,
  remnashopRefreshExpiresAt: null,
  remnashopRefreshClaimTokenHash: null,
  remnashopRefreshLeaseExpiresAt: null,
  remnashopRefreshDispatchedAt: null,
  remnashopRefreshRecoveryEncrypted: null,
} as const;

export const clearedRefreshFence = {
  remnashopRefreshClaimTokenHash: null,
  remnashopRefreshLeaseExpiresAt: null,
  remnashopRefreshDispatchedAt: null,
  remnashopRefreshRecoveryEncrypted: null,
} as const;

export function encryptedBundle(session: LockedSession) {
  return {
    remnashopAccessTokenEncrypted: session.remnashopAccessTokenEncrypted,
    remnashopRefreshTokenEncrypted: session.remnashopRefreshTokenEncrypted,
    remnashopAccessExpiresAt: session.remnashopAccessExpiresAt,
    remnashopRefreshExpiresAt: session.remnashopRefreshExpiresAt,
  };
}

export function hasAnyTokenMaterial(session: LockedSession) {
  return Boolean(
    session.remnashopAccessTokenEncrypted
      || session.remnashopRefreshTokenEncrypted
      || session.remnashopAccessExpiresAt
      || session.remnashopRefreshExpiresAt
      || session.remnashopRefreshClaimTokenHash
      || session.remnashopRefreshLeaseExpiresAt
      || session.remnashopRefreshDispatchedAt
      || session.remnashopRefreshRecoveryEncrypted,
  );
}

export function refreshClaimHash(token: string) {
  return sha256(`clean-pay:remnashop-refresh:claim:v1:${token}`);
}

export function parseRecoveryDate(value: string, field: string) {
  const parsed = new Date(value);

  if (Number.isNaN(parsed.getTime())) {
    throw new ServiceError(
      "UPSTREAM_ERROR",
      502,
      `Remnashop refresh returned an invalid ${field}`,
    );
  }

  return parsed;
}

export function normalizeRefreshResult(
  refreshed: RefreshResult,
  comparisonNow?: Date,
): RefreshRecovery {
  const accessToken = refreshed.cookies.accessToken;
  const refreshToken = refreshed.cookies.refreshToken;

  if (
    typeof accessToken !== "string"
    || accessToken.length === 0
    || accessToken.length > 65_536
    || typeof refreshToken !== "string"
    || refreshToken.length === 0
    || refreshToken.length > 65_536
  ) {
    throw new ServiceError(
      "UPSTREAM_ERROR",
      502,
      "Remnashop refresh returned an invalid token bundle",
    );
  }

  const accessExpiresAt = parseRecoveryDate(
    refreshed.data.expires_at,
    "access expiry",
  );
  const refreshExpiresAt = parseRecoveryDate(
    refreshed.data.refresh_expires_at,
    "refresh expiry",
  );

  const now = comparisonNow ?? new Date();
  if (
    accessExpiresAt <= now
    || refreshExpiresAt <= now
    || refreshExpiresAt <= accessExpiresAt
  ) {
    throw new ServiceError(
      "UPSTREAM_ERROR",
      502,
      "Remnashop refresh returned an unusable token expiry window",
    );
  }

  return {
    version: 1,
    accessToken,
    refreshToken,
    accessExpiresAt: accessExpiresAt.toISOString(),
    refreshExpiresAt: refreshExpiresAt.toISOString(),
  };
}

export function assertRecoveryUsableForCaller(
  recovery: RefreshRecovery,
  comparisonNow?: Date,
) {
  const now = comparisonNow ?? new Date();
  const accessExpiresAt = new Date(recovery.accessExpiresAt);
  const refreshExpiresAt = new Date(recovery.refreshExpiresAt);

  if (accessExpiresAt <= now || refreshExpiresAt <= now) {
    throw new ServiceError(
      "UPSTREAM_UNAVAILABLE",
      503,
      "Remnashop refresh completed with a token bundle that expired during finalization",
    );
  }
}

export function retryAfterSeconds(leaseExpiresAt: Date, now: Date) {
  return Math.min(
    5,
    Math.max(
      1,
      Math.ceil((leaseExpiresAt.getTime() - now.getTime()) / 1_000),
    ),
  );
}

export function isTerminalProviderRefreshRejection(error: unknown) {
  return error instanceof ServiceError
    && (error.code === "UNAUTHORIZED" || error.code === "AUTH_FAILED")
    && error.debug?.upstreamStatus === 401
    && error.debug?.upstreamPath === "/auth/refresh";
}
