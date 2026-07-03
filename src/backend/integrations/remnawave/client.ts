import { getEnv } from "@/backend/config/env";
import { logger } from "@/backend/observability/logger";

type RemnawaveUser = {
  uuid?: string;
  status?: string;
  email?: string | null;
  telegramId?: number | string | null;
  expireAt?: string | null;
  subscriptionUrl?: string | null;
  subscription_url?: string | null;
};

type RemnawaveSingleResponse = {
  response?: RemnawaveUser | null;
};

type RemnawaveListResponse = {
  response?: RemnawaveUser[] | null;
};

type LiveSubscriptionUrlInput = {
  userRemnaId?: string | null;
  email?: string | null;
  telegramId?: string | number | null;
};

function remnawaveEndpoint(path: string) {
  const baseUrl = getEnv().remnawave.apiBaseUrl?.replace(/\/$/, "");

  if (!baseUrl) {
    return null;
  }

  return `${baseUrl}/api${path}`;
}

function isValidSubscriptionUrl(value: unknown) {
  if (typeof value !== "string" || !value) {
    return false;
  }

  try {
    const url = new URL(value);

    return url.protocol === "https:" || url.protocol === "http:";
  } catch {
    return false;
  }
}

function subscriptionUrl(user: RemnawaveUser | null | undefined) {
  const value = user?.subscriptionUrl ?? user?.subscription_url;

  return isValidSubscriptionUrl(value) ? value : null;
}

function preferActiveUsers(users: RemnawaveUser[]) {
  return [...users].sort((left, right) => {
    const leftActive = left.status === "ACTIVE" ? 1 : 0;
    const rightActive = right.status === "ACTIVE" ? 1 : 0;

    if (leftActive !== rightActive) {
      return rightActive - leftActive;
    }

    return Date.parse(right.expireAt ?? "") - Date.parse(left.expireAt ?? "");
  });
}

async function remnawaveRequest<T>(path: string) {
  const endpoint = remnawaveEndpoint(path);
  const token = getEnv().remnawave.token;

  if (!endpoint || !token) {
    logger.warn("remnawave_live_subscription_skipped", {
      path,
      hasEndpoint: Boolean(endpoint),
      hasToken: Boolean(token),
    }, {
      category: "upstream",
      source: "remnawave.client",
      message: "Skipped live Remnawave subscription lookup",
    });
    return null;
  }

  try {
    const response = await fetch(endpoint, {
      headers: {
        accept: "application/json",
        authorization: token.startsWith("Bearer ") ? token : `Bearer ${token}`,
      },
      cache: "no-store",
    });

    if (response.status === 404) {
      return null;
    }

    if (!response.ok) {
      logger.warn("remnawave_live_subscription_failed", {
        path,
        status: response.status,
      }, {
        category: "upstream",
        source: "remnawave.client",
        message: `Remnawave lookup failed: GET ${path} -> ${response.status}`,
      });
      return null;
    }

    return await response.json() as T;
  } catch (error) {
    logger.warn("remnawave_live_subscription_unavailable", {
      path,
      errorName: error instanceof Error ? error.name : "UnknownError",
    }, {
      category: "upstream",
      source: "remnawave.client",
      message: `Remnawave lookup unavailable: GET ${path}`,
    });
    return null;
  }
}

async function getUserByUuid(uuid: string) {
  const data = await remnawaveRequest<RemnawaveSingleResponse>(`/users/${encodeURIComponent(uuid)}`);

  return data?.response ?? null;
}

async function getUsersByEmail(email: string) {
  const data = await remnawaveRequest<RemnawaveListResponse>(`/users/by-email/${encodeURIComponent(email)}`);

  return data?.response ?? [];
}

async function getUsersByTelegramId(telegramId: string | number) {
  const data = await remnawaveRequest<RemnawaveListResponse>(`/users/by-telegram-id/${encodeURIComponent(String(telegramId))}`);

  return data?.response ?? [];
}

export async function getLiveRemnawaveSubscriptionUrl(input: LiveSubscriptionUrlInput) {
  if (input.userRemnaId) {
    const user = await getUserByUuid(input.userRemnaId);
    const url = subscriptionUrl(user);

    if (url) {
      return url;
    }
  }

  const users = [
    ...(input.telegramId ? await getUsersByTelegramId(input.telegramId) : []),
    ...(input.email ? await getUsersByEmail(input.email) : []),
  ];
  const seen = new Set<string>();
  const uniqueUsers = users.filter((user) => {
    const key = user.uuid ?? `${user.email ?? ""}:${user.telegramId ?? ""}:${user.subscriptionUrl ?? ""}`;

    if (seen.has(key)) {
      return false;
    }

    seen.add(key);
    return true;
  });

  for (const user of preferActiveUsers(uniqueUsers)) {
    const url = subscriptionUrl(user);

    if (url) {
      return url;
    }
  }

  return null;
}
