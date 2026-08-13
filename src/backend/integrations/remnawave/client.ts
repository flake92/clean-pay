import { getEnv } from "@/backend/config/env";
import { ServiceError } from "@/backend/errors/service-error";
import { logger } from "@/backend/observability/logger";
import { recordUpstreamRequest } from "@/backend/observability/metrics";
import { currentRequestTrace, tracedHeaders } from "@/backend/observability/request-trace";

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
  if (typeof value !== "string" || !value || value !== value.trim()) {
    return false;
  }

  try {
    const url = new URL(value);
    const allowedOrigins = getEnv().remnawave.subscriptionOrigins;
    const normalizedHostname = url.hostname.toLowerCase().replace(/^\[/, "").replace(/\]$/, "");
    const octets = normalizedHostname.split(".");
    const ipv4Loopback = octets.length === 4
      && octets[0] === "127"
      && octets.every((octet) => /^(?:0|[1-9]\d{0,2})$/.test(octet) && Number(octet) <= 255);
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

function normalizedIdentity(value: string | number | null | undefined) {
  if (value === null || value === undefined) {
    return null;
  }

  const normalized = String(value).trim();

  return normalized || null;
}

function normalizedEmail(value: string | null | undefined) {
  return normalizedIdentity(value)?.toLowerCase() ?? null;
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

function hasExpectedIdentity(users: RemnawaveUser[], input: LiveSubscriptionUrlInput) {
  const expectedEmail = normalizedEmail(input.email);
  const expectedTelegramId = normalizedIdentity(input.telegramId);

  return (!expectedEmail || users.some((user) => normalizedEmail(user.email) === expectedEmail))
    && (!expectedTelegramId || users.some((user) => normalizedIdentity(user.telegramId) === expectedTelegramId));
}

function unambiguousSubscriptionUrl(users: RemnawaveUser[], input: LiveSubscriptionUrlInput) {
  const expectedUuid = normalizedIdentity(input.userRemnaId);
  const matchingUsers = users.filter((user) => {
    const uuid = normalizedIdentity(user.uuid);

    return Boolean(uuid)
      && (!expectedUuid || uuid === expectedUuid)
      && isLiveUser(user);
  });
  const usersByUuid = new Map<string, RemnawaveUser[]>();

  for (const user of matchingUsers) {
    const uuid = normalizedIdentity(user.uuid)!;
    usersByUuid.set(uuid, [...(usersByUuid.get(uuid) ?? []), user]);
  }

  const urls = [...usersByUuid.values()].flatMap((sameUserRecords) => {
    if (!hasExpectedIdentity(sameUserRecords, input)) {
      return [];
    }

    const uniqueUrls = [...new Set(sameUserRecords.map(subscriptionUrl).filter((url): url is string => Boolean(url)))];

    return uniqueUrls.length === 1 ? uniqueUrls : [];
  });

  return urls.length === 1 ? urls[0] : null;
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

  const startedAt = Date.now();
  const trace = await currentRequestTrace();

  try {
    const response = await fetch(endpoint, {
      headers: tracedHeaders({
        accept: "application/json",
        authorization: token.startsWith("Bearer ") ? token : `Bearer ${token}`,
      }, trace),
      cache: "no-store",
      signal: AbortSignal.timeout(10_000),
    });

    if (response.status === 404) {
      recordUpstreamRequest({ service: "remnawave", operation: path, outcome: "rejected", durationMs: Date.now() - startedAt });
      return null;
    }

    if (!response.ok) {
      recordUpstreamRequest({ service: "remnawave", operation: path, outcome: "rejected", durationMs: Date.now() - startedAt });
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

    recordUpstreamRequest({ service: "remnawave", operation: path, outcome: "success", durationMs: Date.now() - startedAt });
    return await response.json() as T;
  } catch (error) {
    recordUpstreamRequest({ service: "remnawave", operation: path, outcome: "unavailable", durationMs: Date.now() - startedAt });
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

export async function synchronizeRemnawaveUserIdentity(input: {
  uuid: string;
  email: string;
  telegramId: string;
}) {
  const endpoint = remnawaveEndpoint("/users");
  const token = getEnv().remnawave.token;
  if (!endpoint || !token) {
    throw new ServiceError("UPSTREAM_UNAVAILABLE", 503, "Remnawave identity synchronization is not configured.");
  }

  let response: Response;
  const startedAt = Date.now();
  const trace = await currentRequestTrace();
  try {
    response = await fetch(endpoint, {
      method: "PATCH",
      headers: tracedHeaders({
        accept: "application/json",
        authorization: token.startsWith("Bearer ") ? token : `Bearer ${token}`,
        "content-type": "application/json",
      }, trace),
      body: JSON.stringify({
        uuid: input.uuid,
        email: input.email,
        telegramId: Number(input.telegramId),
      }),
      cache: "no-store",
      signal: AbortSignal.timeout(10_000),
    });
  } catch (error) {
    recordUpstreamRequest({ service: "remnawave", operation: "/users", outcome: "unavailable", durationMs: Date.now() - startedAt });
    throw new ServiceError("UPSTREAM_UNAVAILABLE", 503, "Remnawave identity synchronization failed.", {
      cause: error instanceof Error ? error.name : "UnknownError",
    });
  }
  if (!response.ok) {
    recordUpstreamRequest({ service: "remnawave", operation: "/users", outcome: "rejected", durationMs: Date.now() - startedAt });
    throw new ServiceError("UPSTREAM_UNAVAILABLE", 503, "Remnawave identity synchronization was rejected.", {
      upstreamStatus: response.status,
    });
  }
  recordUpstreamRequest({ service: "remnawave", operation: "/users", outcome: "success", durationMs: Date.now() - startedAt });

  const verified = await getUserByUuid(input.uuid);
  if (normalizedIdentity(verified?.uuid) !== normalizedIdentity(input.uuid)
    || normalizedEmail(verified?.email) !== normalizedEmail(input.email)
    || normalizedIdentity(verified?.telegramId) !== normalizedIdentity(input.telegramId)) {
    throw new ServiceError("UPSTREAM_UNAVAILABLE", 503, "Remnawave returned an inconsistent account owner.");
  }
}

export async function getLiveRemnawaveSubscriptionUrl(input: LiveSubscriptionUrlInput) {
  if (input.userRemnaId) {
    const user = await getUserByUuid(input.userRemnaId);
    const isExpectedUser = normalizedIdentity(user?.uuid) === normalizedIdentity(input.userRemnaId);
    const url = isExpectedUser && user && isLiveUser(user) ? subscriptionUrl(user) : null;

    if (url) {
      return url;
    }
  }

  const users = [
    ...(input.telegramId ? await getUsersByTelegramId(input.telegramId) : []),
    ...(input.email ? await getUsersByEmail(input.email) : []),
  ];

  return unambiguousSubscriptionUrl(users, input);
}
