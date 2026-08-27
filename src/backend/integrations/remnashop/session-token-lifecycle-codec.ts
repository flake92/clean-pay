import {
  protectRemnashopToken,
  revealRemnashopTokenEnvelope,
} from "@/backend/integrations/remnashop/token-protection";
import {
  parseRecoveryDate,
  type LockedSession,
  type PreparedTokenCandidate,
  type RefreshRecovery,
} from "@/backend/integrations/remnashop/session-token-lifecycle-transitions";
import { recordOperationalEvent } from "@/backend/observability/metrics";

export function tokenCandidate(
  session: LockedSession,
  now: Date,
): PreparedTokenCandidate | null {
  const encryptedAccessToken = session.remnashopAccessTokenEncrypted;
  const encryptedRefreshToken = session.remnashopRefreshTokenEncrypted;

  if (!encryptedAccessToken || !encryptedRefreshToken) {
    return null;
  }

  if (
    session.remnashopRefreshExpiresAt
    && session.remnashopRefreshExpiresAt <= now
  ) {
    return null;
  }

  try {
    const access = revealRemnashopTokenEnvelope(encryptedAccessToken);
    const refresh = revealRemnashopTokenEnvelope(encryptedRefreshToken);
    const rewrap = access.needsRewrap || refresh.needsRewrap
      ? {
          accessTokenEncrypted: encryptedAccessToken,
          refreshTokenEncrypted: encryptedRefreshToken,
          data: {
            remnashopAccessTokenEncrypted: protectRemnashopToken(access.value),
            remnashopRefreshTokenEncrypted: protectRemnashopToken(refresh.value),
          },
        }
      : null;
    return {
      session: rewrap ? { ...session, ...rewrap.data } : session,
      accessToken: access.value,
      refreshToken: refresh.value,
      rewrap,
    } satisfies PreparedTokenCandidate;
  } catch {
    return null;
  }
}

export function decodeRefreshRecovery(
  encrypted: string,
  comparisonNow?: Date,
): RefreshRecovery {
  const revealed = revealRemnashopTokenEnvelope(encrypted);
  const parsed = JSON.parse(revealed.value) as Partial<RefreshRecovery>;

  if (
    parsed.version !== 1
    || typeof parsed.accessToken !== "string"
    || parsed.accessToken.length === 0
    || parsed.accessToken.length > 65_536
    || typeof parsed.refreshToken !== "string"
    || parsed.refreshToken.length === 0
    || parsed.refreshToken.length > 65_536
    || typeof parsed.accessExpiresAt !== "string"
    || typeof parsed.refreshExpiresAt !== "string"
  ) {
    throw new Error("Invalid Remnashop refresh recovery payload");
  }

  const accessExpiresAt = parseRecoveryDate(
    parsed.accessExpiresAt,
    "recovery access expiry",
  );
  const refreshExpiresAt = parseRecoveryDate(
    parsed.refreshExpiresAt,
    "recovery refresh expiry",
  );
  const now = comparisonNow ?? new Date();
  if (refreshExpiresAt <= now || refreshExpiresAt <= accessExpiresAt) {
    throw new Error("Invalid Remnashop refresh recovery expiry window");
  }

  if (revealed.needsRewrap) {
    // The repository writes a fresh current-key token bundle and removes this
    // recovery envelope in the same transaction.
    recordOperationalEvent("encrypted_refresh_recovery_rewrapped");
  }

  return parsed as RefreshRecovery;
}

export function encryptedRecovery(recovery: RefreshRecovery) {
  return protectRemnashopToken(JSON.stringify(recovery));
}

export function refreshedBundle(recovery: RefreshRecovery) {
  return {
    remnashopAccessTokenEncrypted: protectRemnashopToken(recovery.accessToken),
    remnashopRefreshTokenEncrypted: protectRemnashopToken(recovery.refreshToken),
    remnashopAccessExpiresAt: new Date(recovery.accessExpiresAt),
    remnashopRefreshExpiresAt: new Date(recovery.refreshExpiresAt),
  };
}
