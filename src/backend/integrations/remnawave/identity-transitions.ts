import type { RemnawaveUser } from "@/backend/integrations/remnawave/decoders";

export type LiveSubscriptionUrlInput = {
  userRemnaId?: string | null;
  email?: string | null;
  telegramId?: string | number | null;
};

export function normalizedRemnawaveIdentity(
  value: string | number | null | undefined,
) {
  if (value === null || value === undefined) {
    return null;
  }

  const normalized = String(value).trim();

  return normalized || null;
}

export function normalizedRemnawaveEmail(
  value: string | null | undefined,
) {
  return normalizedRemnawaveIdentity(value)?.toLowerCase() ?? null;
}

export function remnawaveIdentitySynchronizationState(
  user: RemnawaveUser | null | undefined,
  input: { uuid: string; email: string; telegramId: string },
) {
  return {
    uuidMatches:
      normalizedRemnawaveIdentity(user?.uuid)
      === normalizedRemnawaveIdentity(input.uuid),
    emailMatches:
      normalizedRemnawaveEmail(user?.email)
      === normalizedRemnawaveEmail(input.email),
    telegramMatches:
      normalizedRemnawaveIdentity(user?.telegramId)
      === normalizedRemnawaveIdentity(input.telegramId),
  };
}

export function remnawaveUserHasAnyExpectedIdentity(
  user: RemnawaveUser,
  input: LiveSubscriptionUrlInput,
) {
  const expectedEmail = normalizedRemnawaveEmail(input.email);
  const expectedTelegramId = normalizedRemnawaveIdentity(input.telegramId);

  return Boolean(
    (expectedEmail
      && normalizedRemnawaveEmail(user.email) === expectedEmail)
      || (expectedTelegramId
        && normalizedRemnawaveIdentity(user.telegramId) === expectedTelegramId),
  );
}

function remnawaveUsersHaveExpectedIdentity(
  users: RemnawaveUser[],
  input: LiveSubscriptionUrlInput,
) {
  const expectedEmail = normalizedRemnawaveEmail(input.email);
  const expectedTelegramId = normalizedRemnawaveIdentity(input.telegramId);

  return (
    !expectedEmail
    || users.some(
      (user) => normalizedRemnawaveEmail(user.email) === expectedEmail,
    )
  ) && (
    !expectedTelegramId
    || users.some(
      (user) => normalizedRemnawaveIdentity(user.telegramId) === expectedTelegramId,
    )
  );
}

export function selectUnambiguousRemnawaveSubscriptionUrl(
  users: RemnawaveUser[],
  input: LiveSubscriptionUrlInput,
  policies: {
    isLiveUser: (user: RemnawaveUser) => boolean;
    subscriptionUrl: (user: RemnawaveUser) => string | null;
  },
) {
  const expectedUuid = normalizedRemnawaveIdentity(input.userRemnaId);
  const matchingUsers = users.filter((user) => {
    const uuid = normalizedRemnawaveIdentity(user.uuid);

    return Boolean(uuid)
      && (!expectedUuid || uuid === expectedUuid)
      && policies.isLiveUser(user);
  });
  const usersByUuid = new Map<string, RemnawaveUser[]>();

  for (const user of matchingUsers) {
    const uuid = normalizedRemnawaveIdentity(user.uuid)!;
    usersByUuid.set(uuid, [...(usersByUuid.get(uuid) ?? []), user]);
  }

  const urls = [...usersByUuid.values()].flatMap((sameUserRecords) => {
    if (!remnawaveUsersHaveExpectedIdentity(sameUserRecords, input)) {
      return [];
    }

    const uniqueUrls = [
      ...new Set(
        sameUserRecords
          .map(policies.subscriptionUrl)
          .filter((url): url is string => Boolean(url)),
      ),
    ];

    return uniqueUrls.length === 1 ? uniqueUrls : [];
  });

  return urls.length === 1 ? urls[0] : null;
}
