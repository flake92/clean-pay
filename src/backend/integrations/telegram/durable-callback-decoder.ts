import type {
  ConsumedTelegramCallback,
  TelegramCallbackOutcome,
  VerifiedTelegramCallback,
} from "@/application/auth/ports/telegram-callback";
import type {
  DurableTelegramCallbackCheckpoint,
  DurableTelegramCallbackReplay,
  StoredDurableTelegramCallbackCheckpoint,
} from "@/backend/integrations/telegram/durable-callback-contract";
import {
  type DurableTelegramCallbackStatus,
  durableTelegramCallbackStatus,
} from "@/backend/integrations/telegram/durable-callback-contract";

export function boundedDurableCallbackString(
  value: unknown,
  maximum: number,
): value is string {
  return typeof value === "string"
    && value.length > 0
    && Buffer.byteLength(value, "utf8") <= maximum;
}

export function isDurableCallbackRecord(
  value: unknown,
): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function nullableString(value: unknown, maximum = 4_096) {
  return value === null
    || value === undefined
    || boundedDurableCallbackString(value, maximum);
}

function assertProviderSession(value: unknown) {
  if (value === null) return;
  if (!isDurableCallbackRecord(value) || !isDurableCallbackRecord(value.context)) {
    throw new Error("Invalid durable Telegram provider session");
  }
  const context = value.context;
  if (!isDurableCallbackRecord(context.cookies) || !isDurableCallbackRecord(context.data)) {
    throw new Error("Invalid durable Telegram provider session context");
  }
  if (
    !boundedDurableCallbackString(context.cookies.accessToken, 32_768)
    || !boundedDurableCallbackString(context.cookies.refreshToken, 32_768)
    || !boundedDurableCallbackString(context.data.expires_at, 256)
    || !boundedDurableCallbackString(context.data.refresh_expires_at, 256)
  ) {
    throw new Error("Invalid durable Telegram provider credentials");
  }
}

function parseVerified(value: unknown): VerifiedTelegramCallback {
  if (
    !isDurableCallbackRecord(value)
    || !isDurableCallbackRecord(value.authState)
    || !isDurableCallbackRecord(value.identity)
  ) {
    throw new Error("Invalid durable verified Telegram callback");
  }
  const { authState, identity } = value;
  if (
    !boundedDurableCallbackString(authState.id, 256)
    || !nullableString(authState.targetUserId, 256)
    || !nullableString(authState.redirectTo, 512)
    || !boundedDurableCallbackString(identity.telegramId, 64)
    || !nullableString(identity.telegramUsername, 256)
    || !nullableString(identity.fullName, 512)
    || !nullableString(identity.photoUrl, 2_048)
  ) {
    throw new Error("Invalid durable verified Telegram identity");
  }
  assertProviderSession(identity.providerSession);
  return value as VerifiedTelegramCallback;
}

function parseProviderReady(value: unknown) {
  if (!isDurableCallbackRecord(value) || !isDurableCallbackRecord(value.authState)) {
    throw new Error("Invalid durable Telegram provider-ready checkpoint");
  }
  const authState = value.authState;
  if (
    !boundedDurableCallbackString(authState.id, 256)
    || !nullableString(authState.targetUserId, 256)
    || !nullableString(authState.redirectTo, 512)
  ) {
    throw new Error("Invalid durable Telegram provider-ready auth state");
  }
  return {
    id: authState.id as string,
    targetUserId: (authState.targetUserId as string | null | undefined) ?? null,
    redirectTo: (authState.redirectTo as string | null | undefined) ?? null,
  };
}

function parseConsumed(value: unknown): ConsumedTelegramCallback {
  if (!isDurableCallbackRecord(value) || !isDurableCallbackRecord(value.user)) {
    throw new Error("Invalid durable consumed Telegram callback");
  }
  if (
    !boundedDurableCallbackString(value.user.id, 256)
    || !nullableString(value.user.upstreamAccountId, 256)
    || !nullableString(value.user.email, 512)
    || typeof value.user.emailVerified !== "boolean"
    || !nullableString(value.user.telegramId, 64)
    || !nullableString(value.redirectTo, 512)
    || typeof value.linked !== "boolean"
    || !boundedDurableCallbackString(value.telegramId, 64)
    || !nullableString(value.telegramUsername, 256)
  ) {
    throw new Error("Invalid durable consumed Telegram identity");
  }
  assertProviderSession(value.providerSession);
  if (value.mergeConfirmation !== null) {
    if (
      !isDurableCallbackRecord(value.mergeConfirmation)
      || typeof value.mergeConfirmation.required !== "boolean"
      || !boundedDurableCallbackString(value.mergeConfirmation.token, 4_096)
    ) {
      throw new Error("Invalid durable Telegram merge checkpoint");
    }
  }
  return value as ConsumedTelegramCallback;
}

function parseOutcome(value: unknown): TelegramCallbackOutcome {
  if (!isDurableCallbackRecord(value) || !isDurableCallbackRecord(value.audit)) {
    throw new Error("Invalid durable Telegram callback outcome");
  }
  if (
    !boundedDurableCallbackString(value.redirectTo, 512)
    || !boundedDurableCallbackString(value.audit.userId, 256)
    || typeof value.audit.remnashopLinked !== "boolean"
  ) {
    throw new Error("Invalid durable Telegram callback audit outcome");
  }
  if (value.mergeConfirmation !== undefined) {
    if (
      !isDurableCallbackRecord(value.mergeConfirmation)
      || !boundedDurableCallbackString(value.mergeConfirmation.token, 4_096)
    ) {
      throw new Error("Invalid durable Telegram merge outcome");
    }
  }
  if (value.session !== undefined) {
    if (
      !isDurableCallbackRecord(value.session)
      || !boundedDurableCallbackString(value.session.userId, 256)
      || typeof value.session.requiresTelegramRecovery !== "boolean"
    ) {
      throw new Error("Invalid durable Telegram session outcome");
    }
    if (value.session.remnashopSession !== undefined) {
      const provider = value.session.remnashopSession;
      if (
        !isDurableCallbackRecord(provider)
        || !boundedDurableCallbackString(provider.accessTokenEncrypted, 64 * 1024)
        || !boundedDurableCallbackString(provider.refreshTokenEncrypted, 64 * 1024)
        || !boundedDurableCallbackString(provider.accessExpiresAt, 256)
        || !boundedDurableCallbackString(provider.refreshExpiresAt, 256)
      ) {
        throw new Error("Invalid durable Telegram stored provider outcome");
      }
      const accessExpiresAt = new Date(provider.accessExpiresAt);
      const refreshExpiresAt = new Date(provider.refreshExpiresAt);
      if (Number.isNaN(accessExpiresAt.getTime()) || Number.isNaN(refreshExpiresAt.getTime())) {
        throw new Error("Invalid durable Telegram provider expiry");
      }
      provider.accessExpiresAt = accessExpiresAt;
      provider.refreshExpiresAt = refreshExpiresAt;
    }
  }
  if (Boolean(value.session) === Boolean(value.mergeConfirmation)) {
    throw new Error("Durable Telegram outcome must have one bootstrap result");
  }
  return value as unknown as TelegramCallbackOutcome;
}

export function parseDurableTelegramReplay(
  value: unknown,
): DurableTelegramCallbackReplay {
  if (!isDurableCallbackRecord(value) || !isDurableCallbackRecord(value.audit)) {
    throw new Error("Invalid durable Telegram replay");
  }
  if (
    !boundedDurableCallbackString(value.redirectTo, 512)
    || !boundedDurableCallbackString(value.audit.userId, 256)
    || typeof value.audit.remnashopLinked !== "boolean"
  ) {
    throw new Error("Invalid durable Telegram replay audit");
  }
  if (value.session !== undefined) {
    if (
      !isDurableCallbackRecord(value.session)
      || !boundedDurableCallbackString(value.session.webSessionId, 256)
      || !boundedDurableCallbackString(value.session.userId, 256)
      || !boundedDurableCallbackString(value.session.bootstrapRefreshToken, 4_096)
      || typeof value.session.requiresTelegramRecovery !== "boolean"
    ) {
      throw new Error("Invalid durable Telegram replay session");
    }
  }
  if (value.mergeConfirmation !== undefined) {
    if (
      !isDurableCallbackRecord(value.mergeConfirmation)
      || !boundedDurableCallbackString(value.mergeConfirmation.token, 4_096)
    ) {
      throw new Error("Invalid durable Telegram replay merge confirmation");
    }
  }
  if (Boolean(value.session) === Boolean(value.mergeConfirmation)) {
    throw new Error("Durable Telegram replay must have one bootstrap result");
  }
  return value as DurableTelegramCallbackReplay;
}

export function parseStoredDurableTelegramCallbackCheckpoint(
  value: unknown,
): Partial<StoredDurableTelegramCallbackCheckpoint> {
  const stored = value as Partial<StoredDurableTelegramCallbackCheckpoint>;
  if (stored.version !== 2 || typeof stored.phase !== "string") {
    throw new Error("Invalid durable Telegram callback checkpoint envelope");
  }
  return stored;
}

export function parseDurableTelegramCheckpointValue(
  status: DurableTelegramCallbackStatus,
  value: unknown,
): DurableTelegramCallbackCheckpoint {
  switch (status) {
    case durableTelegramCallbackStatus.PROVIDER_READY:
      return { phase: "PROVIDER_READY", authState: parseProviderReady(value) };
    case durableTelegramCallbackStatus.IDENTITY_VERIFIED:
      return { phase: "IDENTITY_VERIFIED", verified: parseVerified(value) };
    case durableTelegramCallbackStatus.PROVIDER_AUTHENTICATED:
      return { phase: "PROVIDER_AUTHENTICATED", verified: parseVerified(value) };
    case durableTelegramCallbackStatus.IDENTITY_RESOLVED:
      return { phase: "IDENTITY_RESOLVED", consumed: parseConsumed(value) };
    case durableTelegramCallbackStatus.OUTCOME_READY:
      return { phase: "OUTCOME_READY", outcome: parseOutcome(value) };
    case durableTelegramCallbackStatus.SESSION_CREATED:
      return { phase: "SESSION_CREATED", replay: parseDurableTelegramReplay(value) };
    default:
      throw new Error("Telegram callback phase is not resumable");
  }
}

export function parseDurableTelegramFailureRedirect(
  stored: Partial<StoredDurableTelegramCallbackCheckpoint>,
) {
  if (
    stored.phase !== durableTelegramCallbackStatus.FAILED
    || !isDurableCallbackRecord(stored.value)
    || !boundedDurableCallbackString(stored.value.redirectTo, 512)
  ) {
    throw new Error("Invalid durable Telegram failure checkpoint");
  }
  return stored.value.redirectTo;
}
