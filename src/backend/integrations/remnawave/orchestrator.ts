import { getEnv } from "@/backend/config/env";
import { ServiceError } from "@/backend/errors/service-error";
import {
  decodeRemnawaveListResponse,
  decodeRemnawaveSingleResponse,
} from "@/backend/integrations/remnawave/decoders";
import type { RemnawaveUser } from "@/backend/integrations/remnawave/decoders";
import {
  normalizedRemnawaveIdentity,
  remnawaveIdentitySynchronizationState,
  remnawaveUserHasAnyExpectedIdentity,
  selectUnambiguousRemnawaveSubscriptionUrl,
} from "@/backend/integrations/remnawave/identity-transitions";
import type { LiveSubscriptionUrlInput } from "@/backend/integrations/remnawave/identity-transitions";
import {
  patchRemnawaveUserIdentity,
  remnawaveIdentitySynchronizationTarget,
  requestRemnawave,
} from "@/backend/integrations/remnawave/transport";

function isValidSubscriptionUrl(value: unknown) {
  if (typeof value !== "string" || !value || value !== value.trim()) {
    return false;
  }

  try {
    const url = new URL(value);
    const allowedOrigins = getEnv().remnawave.subscriptionOrigins;
    const normalizedHostname = url.hostname
      .toLowerCase()
      .replace(/^\[/, "")
      .replace(/\]$/, "");
    const octets = normalizedHostname.split(".");
    const ipv4Loopback = octets.length === 4
      && octets[0] === "127"
      && octets.every(
        (octet) => /^(?:0|[1-9]\d{0,2})$/.test(octet)
          && Number(octet) <= 255,
      );
    const developmentLoopbackHttp = process.env.NODE_ENV !== "production"
      && url.protocol === "http:"
      && (
        normalizedHostname === "localhost"
        || normalizedHostname.endsWith(".localhost")
        || normalizedHostname === "::1"
        || ipv4Loopback
      );

    return !url.username
      && !url.password
      && allowedOrigins.includes(url.origin)
      && (url.protocol === "https:" || developmentLoopbackHttp);
  } catch {
    return false;
  }
}

function subscriptionUrl(user: RemnawaveUser | null | undefined) {
  const value = user?.subscriptionUrl ?? user?.subscription_url;

  return isValidSubscriptionUrl(value) ? new URL(value!).toString() : null;
}

function isLiveUser(user: RemnawaveUser) {
  if (user.status !== "ACTIVE") {
    return false;
  }

  if (!user.expireAt) {
    return true;
  }

  const expiresAt = Date.parse(user.expireAt);

  return Number.isFinite(expiresAt) && expiresAt > Date.now();
}

async function getUserByUuid(uuid: string) {
  const data = await requestRemnawave(
    `/users/${encodeURIComponent(uuid)}`,
    decodeRemnawaveSingleResponse,
  );

  return data?.response ?? null;
}

async function getUsersByEmail(email: string) {
  const data = await requestRemnawave(
    `/users/by-email/${encodeURIComponent(email)}`,
    decodeRemnawaveListResponse,
  );

  return data?.response ?? [];
}

async function getUsersByTelegramId(telegramId: string | number) {
  const data = await requestRemnawave(
    `/users/by-telegram-id/${encodeURIComponent(String(telegramId))}`,
    decodeRemnawaveListResponse,
  );

  return data?.response ?? [];
}

export async function synchronizeRemnawaveUserIdentity(
  input: { uuid: string; email: string; telegramId: string },
  beforeMutation: () => Promise<void>,
) {
  const target = remnawaveIdentitySynchronizationTarget();
  const current = await getUserByUuid(input.uuid);
  const currentIdentity = remnawaveIdentitySynchronizationState(current, input);

  if (
    !currentIdentity.uuidMatches
    || (!currentIdentity.emailMatches && !currentIdentity.telegramMatches)
  ) {
    throw new ServiceError(
      "UPSTREAM_UNAVAILABLE",
      503,
      "Remnawave subscription owner could not be verified.",
    );
  }

  if (currentIdentity.emailMatches && currentIdentity.telegramMatches) {
    return;
  }

  await beforeMutation();

  const patchOutcome = await patchRemnawaveUserIdentity(target, input);
  if (patchOutcome.kind === "unavailable") {
    throw new ServiceError(
      "UPSTREAM_UNAVAILABLE",
      503,
      "Remnawave identity synchronization failed.",
      { cause: patchOutcome.errorName },
    );
  }
  if (patchOutcome.kind === "rejected") {
    throw new ServiceError(
      "UPSTREAM_UNAVAILABLE",
      503,
      "Remnawave identity synchronization was rejected.",
      { upstreamStatus: patchOutcome.status },
    );
  }

  const verified = await getUserByUuid(input.uuid);
  const verifiedIdentity = remnawaveIdentitySynchronizationState(
    verified,
    input,
  );
  if (
    !verifiedIdentity.uuidMatches
    || !verifiedIdentity.emailMatches
    || !verifiedIdentity.telegramMatches
  ) {
    throw new ServiceError(
      "UPSTREAM_UNAVAILABLE",
      503,
      "Remnawave returned an inconsistent account owner.",
    );
  }
}

export function assertRemnawaveIdentitySynchronizationConfigured() {
  remnawaveIdentitySynchronizationTarget();
}

export async function getLiveRemnawaveSubscriptionUrl(
  input: LiveSubscriptionUrlInput,
) {
  if (input.userRemnaId) {
    const user = await getUserByUuid(input.userRemnaId);
    const isExpectedUser = normalizedRemnawaveIdentity(user?.uuid)
      === normalizedRemnawaveIdentity(input.userRemnaId)
      && Boolean(user && remnawaveUserHasAnyExpectedIdentity(user, input));
    const url = isExpectedUser && user && isLiveUser(user)
      ? subscriptionUrl(user)
      : null;

    if (url) {
      return url;
    }
  }

  const users = [
    ...(input.telegramId
      ? await getUsersByTelegramId(input.telegramId)
      : []),
    ...(input.email ? await getUsersByEmail(input.email) : []),
  ];

  return selectUnambiguousRemnawaveSubscriptionUrl(users, input, {
    isLiveUser,
    subscriptionUrl,
  });
}
