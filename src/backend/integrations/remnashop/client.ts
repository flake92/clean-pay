import { createHash, createHmac } from "node:crypto";
import { Prisma } from "@prisma/client";
import {
  assertUserMergeFinalOwner,
  mergeLocalUsersIntoTarget,
} from "@/backend/auth/user-merge";
import { authDebugLog } from "@/backend/observability/auth-debug-log";
import { getEnv } from "@/backend/config/env";
import { logger } from "@/backend/observability/logger";
import { prisma } from "@/backend/database/prisma";
import {
  BffError,
  normalizeRemnashopError,
  remnashopInvalidJsonError,
  remnashopUnavailableError,
} from "@/backend/integrations/remnashop/errors";
import type {
  ChangePasswordRequest,
  ChangePasswordResponse,
  LoginRequest,
  RegisterRequest,
  RemnashopAuthResponse,
  RemnashopMe,
  TelegramAuthRequest,
  TelegramWebAppAuthRequest,
} from "@/shared/remnashop/types";
import {
  assertEmailVerificationPolicy,
  getCurrentSession,
  refreshCurrentAccessCookie,
} from "@/backend/sessions/web-session";
import { acquireRemnashopTokensForSession } from "@/backend/integrations/remnashop/session-token-lifecycle";
import { protectRemnashopToken } from "@/backend/integrations/remnashop/token-protection";
import {
  assertNoActivePaymentDispatches,
  lockPaymentOwnerFence,
  preflightPaymentOperationsForUserMerge,
  transferPaymentOperationsForUserMerge,
} from "@/backend/payments/user-merge";

export { protectRemnashopToken, revealRemnashopToken } from "@/backend/integrations/remnashop/token-protection";

type RequestOptions = {
  method?: "GET" | "POST" | "DELETE";
  body?: unknown;
  accessToken?: string;
  refreshToken?: string;
  idempotencyKey?: string;
  timeoutMs?: number;
  allowNotFound?: boolean;
};

type AuthCookies = {
  accessToken: string;
  refreshToken: string;
};

function endpoint(path: string) {
  return `${getEnv().remnashopApiBaseUrl}${path}`;
}

function safeRequestPath(path: string) {
  return path.split("?", 1)[0] ?? path;
}

function adminEndpoint(path: string) {
  return `${getEnv().remnashopAdminApiBaseUrl}${path}`;
}

async function parseResponse<T>(response: Response, path: string) {
  const text = await response.text();
  let data: unknown = null;

  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      if (!response.ok) {
        throw normalizeRemnashopError(response.status, text, { path });
      }

      throw remnashopInvalidJsonError(path, text);
    }
  }

  if (!response.ok) {
    const detail =
      data && typeof data === 'object' && 'detail' in data
        ? (data as { detail: unknown }).detail
        : data;

    throw normalizeRemnashopError(response.status, detail, { path });
  }

  return data as T;
}

async function fetchRemnashop(path: string, init: RequestInit) {
  const method = init.method ?? "GET";
  const startedAt = Date.now();
  const safePath = safeRequestPath(path);

  logger.info("remnashop_request_sent", {
    method,
    path: safePath,
    hasBody: Boolean(init.body),
  }, {
    category: "upstream",
    source: "remnashop.client",
    message: `HTTP Request: ${method} ${safePath}`,
  });

  try {
    const response = await fetch(endpoint(path), init);

    logger.info("remnashop_response_received", {
      method,
      path: safePath,
      status: response.status,
      ok: response.ok,
      durationMs: Date.now() - startedAt,
    }, {
      category: "upstream",
      source: "remnashop.client",
      message: `HTTP Response: ${method} ${safePath} -> ${response.status}`,
    });

    return response;
  } catch (error) {
    logger.error("remnashop_request_failed", {
      method,
      path: safePath,
      durationMs: Date.now() - startedAt,
      errorName: error instanceof Error ? error.name : "UnknownError",
    }, {
      category: "upstream",
      source: "remnashop.client",
      message: `HTTP Request failed: ${method} ${safePath}`,
    });
    throw remnashopUnavailableError(safePath, error);
  }
}

async function fetchRemnashopAdmin(path: string, init: RequestInit) {
  const method = init.method ?? "GET";
  const startedAt = Date.now();
  const safePath = safeRequestPath(path);
  const requestUrl = adminEndpoint(path);

  logger.info("remnashop_admin_request_sent", {
    method,
    path: safePath,
    hasBody: Boolean(init.body),
  }, {
    category: "upstream",
    source: "remnashop.client",
    message: `HTTP Request: ${method} admin ${safePath}`,
  });

  try {
    const response = await fetch(requestUrl, init);

    logger.info("remnashop_admin_response_received", {
      method,
      path: safePath,
      status: response.status,
      ok: response.ok,
      durationMs: Date.now() - startedAt,
    }, {
      category: "upstream",
      source: "remnashop.client",
      message: `HTTP Response: ${method} admin ${safePath} -> ${response.status}`,
    });

    return response;
  } catch (error) {
    logger.error("remnashop_admin_request_failed", {
      method,
      path: safePath,
      durationMs: Date.now() - startedAt,
      errorName: error instanceof Error ? error.name : "UnknownError",
    }, {
      category: "upstream",
      source: "remnashop.client",
      message: `HTTP Admin request failed: ${method} ${safePath}`,
    });
    throw remnashopUnavailableError(safePath, error);
  }
}

function getSetCookieHeaders(response: Response) {
  const headers = response.headers as Headers & {
    getSetCookie?: () => string[];
  };

  if (typeof headers.getSetCookie === "function") {
    return headers.getSetCookie();
  }

  const singleHeader = response.headers.get("set-cookie");

  return singleHeader ? [singleHeader] : [];
}

function getCookieValue(setCookieHeaders: string[], name: string) {
  const prefix = `${name}=`;
  const header = setCookieHeaders.find((item) => item.trim().startsWith(prefix));

  if (!header) {
    return null;
  }

  return header.slice(prefix.length).split(";")[0] ?? null;
}

function extractAuthCookies(response: Response): AuthCookies {
  const setCookieHeaders = getSetCookieHeaders(response);
  const accessToken = getCookieValue(setCookieHeaders, "access_token");
  const refreshToken = getCookieValue(setCookieHeaders, "refresh_token");

  if (!accessToken || !refreshToken) {
    throw new BffError('UPSTREAM_ERROR', 502, 'Auth response did not include auth cookies', { upstreamPath: '/auth' });
  }

  return { accessToken, refreshToken };
}

function decodeJwtPayload(token: string) {
  const [, payload] = token.split(".");

  if (!payload) {
    throw new Error("Invalid JWT payload");
  }

  return JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as {
    sub?: string | number;
    exp?: number;
  };
}

export function getJwtExpiresAt(token: string) {
  const payload = decodeJwtPayload(token);

  return payload.exp ? new Date(payload.exp * 1000) : null;
}

export function getRemnashopUserIdFromAccessToken(accessToken: string) {
  const payload = decodeJwtPayload(accessToken);

  if (payload.sub === undefined || payload.sub === null) {
    throw new Error("Remnashop access token does not contain sub");
  }

  return String(payload.sub);
}

export async function remnashopRequestResult<T>(
  path: string,
  options: RequestOptions = {},
) {
  const headers: Record<string, string> = {
    accept: "application/json",
  };

  if (options.body !== undefined) {
    headers["content-type"] = "application/json";
  }

  if (options.idempotencyKey) {
    headers["idempotency-key"] = options.idempotencyKey;
  }

  if (options.accessToken || options.refreshToken) {
    const cookieParts = [
      options.accessToken ? `access_token=${options.accessToken}` : null,
      options.refreshToken ? `refresh_token=${options.refreshToken}` : null,
    ].filter(Boolean);

    headers.cookie = cookieParts.join("; ");
  }

  const response = await fetchRemnashop(path, {
    method: options.method ?? "GET",
    headers,
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
    cache: "no-store",
    signal: AbortSignal.timeout(options.timeoutMs ?? 15_000),
  });

  if (options.allowNotFound && response.status === 404) {
    await response.body?.cancel();
    return { status: response.status, data: null as T | null };
  }

  return {
    status: response.status,
    data: await parseResponse<T>(response, safeRequestPath(path)),
  };
}

export async function remnashopRequest<T>(
  path: string,
  options: RequestOptions = {},
) {
  const result = await remnashopRequestResult<T>(path, options);

  return result.data as T;
}

export async function remnashopAdminRequestResult<T>(
  path: string,
  options: Omit<RequestOptions, "accessToken" | "refreshToken"> = {},
) {
  const apiKey = getEnv().remnashopApiKey;

  if (!apiKey) {
    throw new BffError(
      "INTERNAL_ERROR",
      500,
      "REMNASHOP_API_KEY is required for an admin Remnashop request.",
    );
  }

  const headers: Record<string, string> = {
    accept: "application/json",
    "x-api-key": apiKey,
  };

  if (options.body !== undefined) {
    headers["content-type"] = "application/json";
  }

  if (options.idempotencyKey) {
    headers["idempotency-key"] = options.idempotencyKey;
  }

  const response = await fetchRemnashopAdmin(path, {
    method: options.method ?? "GET",
    headers,
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
    cache: "no-store",
    signal: AbortSignal.timeout(options.timeoutMs ?? 15_000),
  });

  if (options.allowNotFound && response.status === 404) {
    await response.body?.cancel();
    return { status: response.status, data: null as T | null };
  }

  return {
    status: response.status,
    data: await parseResponse<T>(response, safeRequestPath(path)),
  };
}

export async function remnashopAdminRequest<T>(
  path: string,
  options: Omit<RequestOptions, "accessToken" | "refreshToken"> = {},
) {
  const result = await remnashopAdminRequestResult<T>(path, options);

  return result.data as T;
}

export async function remnashopAuth(
  path: "/auth/register" | "/auth/login" | "/auth/telegram" | "/auth/telegram/webapp",
  body: RegisterRequest | LoginRequest | TelegramAuthRequest | TelegramWebAppAuthRequest,
  { timeoutMs = 15_000 }: { timeoutMs?: number } = {},
) {
  const response = await fetchRemnashop(path, {
    method: "POST",
    headers: {
      accept: "application/json",
      "content-type": "application/json",
    },
    body: JSON.stringify(body),
    cache: "no-store",
    signal: AbortSignal.timeout(timeoutMs),
  });
  const data = await parseResponse<RemnashopAuthResponse>(
    response,
    safeRequestPath(path),
  );
  const cookies = extractAuthCookies(response);

  return { data, cookies };
}

export async function remnashopAuthTelegramIdentity({
  telegramId,
  telegramUsername,
  timeoutMs,
}: {
  telegramId: number | string;
  telegramUsername?: string | null;
  timeoutMs?: number;
}) {
  const botToken = getEnv().telegramBotToken;

  if (!botToken) {
    throw new BffError("INTERNAL_ERROR", 500, "TELEGRAM_BOT_TOKEN is required to authenticate Telegram in Remnashop.");
  }

  const bodyWithoutHash: Omit<TelegramAuthRequest, "hash"> = {
    id: Number(telegramId),
    first_name: telegramUsername || "Telegram",
    username: telegramUsername ?? undefined,
    auth_date: Math.floor(Date.now() / 1000),
  };

  return remnashopAuth(
    "/auth/telegram",
    {
      ...bodyWithoutHash,
      hash: signTelegramAuthPayload(bodyWithoutHash, botToken),
    },
    { timeoutMs },
  );
}

type RemnashopMergeUsersResponse = {
  dry_run: boolean;
  source_user_id: number;
  target_user_id: number;
  target: {
    id: number;
    email: string | null;
    telegram_id: number | null;
    is_email_verified: boolean;
    current_subscription_id: number | null;
  };
  moved: Record<string, number>;
  conflicts: string[];
  requires_relogin: boolean;
};

export async function remnashopMergeUsers({
  sourceUserId,
  targetUserId,
  reason,
  dryRun = false,
  timeoutMs = 15_000,
  emailResolution = "REJECT",
  telegramResolution = "REJECT",
  paymentResolution = "REJECT",
}: {
  sourceUserId: number | string;
  targetUserId: number | string;
  reason: string;
  dryRun?: boolean;
  timeoutMs?: number;
  emailResolution?: "REJECT" | "KEEP_TARGET";
  telegramResolution?: "REJECT" | "KEEP_SOURCE";
  paymentResolution?: "REJECT" | "REKEY_SOURCE";
}) {
  const apiKey = getEnv().remnashopApiKey;

  if (!apiKey) {
    throw new BffError("INTERNAL_ERROR", 500, "REMNASHOP_API_KEY is required to merge Remnashop users.");
  }

  const path = `/users/merge?dry_run=${dryRun ? "true" : "false"}`;
  const response = await fetchRemnashopAdmin(path, {
    method: "POST",
    headers: {
      accept: "application/json",
      "content-type": "application/json",
      "x-api-key": apiKey,
    },
    body: JSON.stringify({
      source_user_id: Number(sourceUserId),
      target_user_id: Number(targetUserId),
      reason,
      email_resolution: emailResolution,
      telegram_resolution: telegramResolution,
      payment_resolution: paymentResolution,
    }),
    cache: "no-store",
    signal: AbortSignal.timeout(timeoutMs),
  });

  return parseResponse<RemnashopMergeUsersResponse>(
    response,
    safeRequestPath(path),
  );
}

export async function remnashopRefreshTokens(refreshToken: string) {
  authDebugLog("remnashop_token_refresh_started", {});
  const response = await fetchRemnashop("/auth/refresh", {
    method: "POST",
    headers: {
      accept: "application/json",
      cookie: `refresh_token=${refreshToken}`,
    },
    cache: "no-store",
    signal: AbortSignal.timeout(15_000),
  });
  const data = await parseResponse<RemnashopAuthResponse>(response, "/auth/refresh");
  const cookies = extractAuthCookies(response);

  authDebugLog("remnashop_token_refresh_success", {
    accessExpiresAt: data.expires_at,
    refreshExpiresAt: data.refresh_expires_at,
  });

  return { data, cookies };
}

export async function remnashopChangePassword(
  accessToken: string,
  body: ChangePasswordRequest,
) {
  const response = await fetchRemnashop("/auth/change-password", {
    method: "POST",
    headers: {
      accept: "application/json",
      "content-type": "application/json",
      cookie: `access_token=${accessToken}`,
    },
    body: JSON.stringify(body),
    cache: "no-store",
    signal: AbortSignal.timeout(15_000),
  });
  const data = await parseResponse<ChangePasswordResponse>(response, "/auth/change-password");
  const cookies = extractAuthCookies(response);

  return { data, cookies };
}

export async function getRemnashopMe(
  accessToken: string,
  { timeoutMs }: { timeoutMs?: number } = {},
) {
  return remnashopRequest<RemnashopMe>("/auth/me", {
    accessToken,
    timeoutMs,
  });
}

export async function remnashopLinkTelegram({
  accessToken,
  telegramId,
  telegramUsername,
}: {
  accessToken: string;
  telegramId: number | string;
  telegramUsername?: string | null;
}) {
  const botToken = getEnv().telegramBotToken;

  if (!botToken) {
    throw new BffError("INTERNAL_ERROR", 500, "TELEGRAM_BOT_TOKEN is required to link Telegram in Remnashop.");
  }

  const bodyWithoutHash: Omit<TelegramAuthRequest, "hash"> = {
    id: Number(telegramId),
    first_name: telegramUsername || "Telegram",
    username: telegramUsername ?? undefined,
    auth_date: Math.floor(Date.now() / 1000),
  };

  return remnashopRequest<RemnashopMe>("/auth/telegram/link", {
    method: "POST",
    accessToken,
    body: {
      ...bodyWithoutHash,
      hash: signTelegramAuthPayload(bodyWithoutHash, botToken),
    },
  });
}

function signTelegramAuthPayload(body: Omit<TelegramAuthRequest, "hash">, botToken: string) {
  const dataCheckString = Object.entries(body)
    .filter(([, value]) => value !== undefined && value !== null && value !== "")
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, value]) => `${key}=${value}`)
    .join("\n");
  const secret = createHash("sha256").update(botToken).digest();

  return createHmac("sha256", secret).update(dataCheckString).digest("hex");
}

export async function attachRemnashopTokensForTelegramSession(
  session: NonNullable<Awaited<ReturnType<typeof getCurrentSession>>>,
) {
  const env = getEnv();
  const telegramId = session.user.telegramId;

  if (!telegramId || !env.telegramBotToken) {
    logger.warn("remnashop_telegram_token_restore_skipped", {
      sessionId: session.id,
      userId: session.userId,
      hasTelegramId: Boolean(telegramId),
      hasTelegramBotToken: Boolean(env.telegramBotToken),
    }, {
      category: "auth",
      source: "remnashop.session",
      message: "Skipped Telegram Remnashop token restore",
    });
    return null;
  }

  logger.info("remnashop_telegram_token_restore_started", {
    sessionId: session.id,
    userId: session.userId,
    telegramId: telegramId.toString(),
    hasTelegramUsername: Boolean(session.user.telegramUsername),
  }, {
    category: "auth",
    source: "remnashop.session",
    message: "Restoring Remnashop session via Telegram",
  });
  authDebugLog("remnashop_telegram_token_restore_started", {
    sessionId: session.id,
    userId: session.userId,
    telegramId: telegramId.toString(),
    hasTelegramUsername: Boolean(session.user.telegramUsername),
  });

  const expectedIdentity = {
    remnashopUserId: session.user.remnashopUserId,
    email: session.user.email,
    emailVerified: session.user.emailVerified,
    telegramId: session.user.telegramId,
    authPending: session.user.authPending,
    pendingRemnashopUserId: session.user.pendingRemnashopUserId,
    pendingRemnashopEmail: session.user.pendingRemnashopEmail,
  };
  const pendingMergeIsProven = Boolean(
    expectedIdentity.authPending &&
    expectedIdentity.pendingRemnashopUserId &&
    expectedIdentity.pendingRemnashopEmail,
  );
  const recoverySourceRemnashopUserId = pendingMergeIsProven
    ? expectedIdentity.pendingRemnashopUserId
    : expectedIdentity.remnashopUserId;
  const recoveryEmail = pendingMergeIsProven
    ? expectedIdentity.pendingRemnashopEmail
    : expectedIdentity.emailVerified
      ? expectedIdentity.email
      : null;
  const normalizedExpectedEmail = recoveryEmail?.trim().toLowerCase() ?? null;
  const ownershipError = (reason: string) =>
    new BffError(
      "ACCOUNT_MERGE_REQUIRED",
      409,
      "Telegram recovery did not prove the expected Remnashop account owner",
      { message: reason },
    );
  const profileMatchesExpectedEmail = (profile: RemnashopMe) =>
    Boolean(
      normalizedExpectedEmail &&
        profile.email?.trim().toLowerCase() === normalizedExpectedEmail &&
        profile.is_email_verified,
    );
  const assertExpectedTelegramProfile = (
    profile: RemnashopMe,
    stage: "before_merge" | "after_merge",
  ) => {
    const profileTelegramId =
      profile.telegram_id === null || profile.telegram_id === undefined
        ? null
        : String(profile.telegram_id);

    if (profileTelegramId !== String(expectedIdentity.telegramId)) {
      throw ownershipError(`telegram_profile_mismatch_${stage}`);
    }
  };
  const sameOwnerSnapshot = (
    left: {
      id: string;
      remnashopUserId: string | null;
      email: string | null;
      emailVerified: boolean;
      telegramId: string | null;
    } | null,
    right: typeof left,
  ) => {
    if (!left || !right) {
      return left === right;
    }

    return (
      left.id === right.id &&
      left.remnashopUserId === right.remnashopUserId &&
      left.email === right.email &&
      left.emailVerified === right.emailVerified &&
      left.telegramId === right.telegramId
    );
  };
  const sameInstant = (left: Date | null, right: Date | null) =>
    (left?.getTime() ?? null) === (right?.getTime() ?? null);
  const numericRemnashopUserId = (value: string, role: string) => {
    if (!/^[1-9]\d*$/.test(value)) {
      throw ownershipError(`invalid_${role}_remnashop_user_id`);
    }

    const numeric = Number(value);

    if (!Number.isSafeInteger(numeric)) {
      throw ownershipError(`unsafe_${role}_remnashop_user_id`);
    }

    return numeric;
  };

  const initialAuth = await remnashopAuthTelegramIdentity({
    telegramId,
    telegramUsername: session.user.telegramUsername,
  });
  const initialRemnashopUserId = getRemnashopUserIdFromAccessToken(
    initialAuth.cookies.accessToken,
  );
  const initialProfile = await getRemnashopMe(initialAuth.cookies.accessToken);
  assertExpectedTelegramProfile(initialProfile, "before_merge");
  const verifiedRecoveryEmail = recoveryEmail ?? (
    initialProfile.is_email_verified ? initialProfile.email : null
  );
  const normalizedVerifiedRecoveryEmail =
    verifiedRecoveryEmail?.trim().toLowerCase() ?? null;

  if (
    recoverySourceRemnashopUserId &&
    recoverySourceRemnashopUserId !== initialRemnashopUserId
  ) {
    if (!normalizedExpectedEmail) {
      throw ownershipError("upstream_id_mismatch_without_verified_email");
    }

    const candidateEmail = initialProfile.email?.trim().toLowerCase() ?? null;

    if (candidateEmail && candidateEmail !== normalizedExpectedEmail) {
      throw ownershipError("telegram_candidate_has_another_email");
    }
  }

  const recovery = await prisma.$transaction(async (tx) => {
    const ownerSelect = {
      id: true,
      remnashopUserId: true,
      email: true,
      emailVerified: true,
      telegramId: true,
    } as const;
    const preflightTargetOwner = await tx.webUser.findUnique({
      where: { remnashopUserId: initialRemnashopUserId },
      select: ownerSelect,
    });
    const preflightSourceOwner =
      recoverySourceRemnashopUserId &&
      recoverySourceRemnashopUserId !== initialRemnashopUserId &&
      recoverySourceRemnashopUserId !== expectedIdentity.remnashopUserId
        ? await tx.webUser.findUnique({
            where: { remnashopUserId: recoverySourceRemnashopUserId },
            select: ownerSelect,
          })
        : null;
    const lookupSeparateEmailOwner = Boolean(
      verifiedRecoveryEmail &&
      verifiedRecoveryEmail.trim().toLowerCase() !==
        (expectedIdentity.email?.trim().toLowerCase() ?? null),
    );
    const preflightEmailOwner = lookupSeparateEmailOwner && verifiedRecoveryEmail
      ? await tx.webUser.findUnique({
          where: { email: verifiedRecoveryEmail },
          select: ownerSelect,
        })
      : null;
    const mergeUserIds = [
      ...new Set([
        session.userId,
        ...[
          preflightTargetOwner,
          preflightSourceOwner,
          preflightEmailOwner,
        ]
          .filter((owner): owner is NonNullable<typeof owner> => Boolean(owner))
          .map(({ id }) => id)
          .filter((id) => id !== session.userId),
      ]),
    ].sort();
    await lockPaymentOwnerFence(tx, mergeUserIds);
    await assertNoActivePaymentDispatches(tx, mergeUserIds);
    const lockedUsers = await tx.$queryRaw<Array<{ id: string }>>(
      Prisma.sql`
        SELECT "id"
        FROM "WebUser"
        WHERE "id" IN (${Prisma.join(mergeUserIds)})
        ORDER BY "id"
        FOR UPDATE
      `,
    );
    const lockedUserIds = new Set(lockedUsers.map(({ id }) => id));

    if (
      lockedUserIds.size !== mergeUserIds.length ||
      mergeUserIds.some((id) => !lockedUserIds.has(id))
    ) {
      throw ownershipError("local_merge_owner_disappeared_before_recovery");
    }

    const currentUser = await tx.webUser.findUnique({
      where: { id: session.userId },
    });
    const currentTargetOwner = await tx.webUser.findUnique({
      where: { remnashopUserId: initialRemnashopUserId },
      select: ownerSelect,
    });
    const currentSourceOwner =
      recoverySourceRemnashopUserId &&
      recoverySourceRemnashopUserId !== initialRemnashopUserId &&
      recoverySourceRemnashopUserId !== expectedIdentity.remnashopUserId
        ? await tx.webUser.findUnique({
            where: { remnashopUserId: recoverySourceRemnashopUserId },
            select: ownerSelect,
          })
        : null;
    const currentEmailOwner = lookupSeparateEmailOwner && verifiedRecoveryEmail
      ? await tx.webUser.findUnique({
          where: { email: verifiedRecoveryEmail },
          select: ownerSelect,
        })
      : null;

    if (
      !sameOwnerSnapshot(preflightTargetOwner, currentTargetOwner) ||
      !sameOwnerSnapshot(preflightSourceOwner, currentSourceOwner) ||
      !sameOwnerSnapshot(preflightEmailOwner, currentEmailOwner)
    ) {
      throw ownershipError("local_merge_owner_changed_before_recovery");
    }

    const lockedSessions = await tx.$queryRaw<Array<{ id: string }>>(
      Prisma.sql`
        SELECT "id"
        FROM "WebSession"
        WHERE "userId" = ${session.userId}
          AND "revokedAt" IS NULL
        ORDER BY "id"
        FOR UPDATE
      `,
    );
    const lockedSessionIds = new Set(lockedSessions.map(({ id }) => id));
    const currentSession = await tx.webSession.findFirst({
      where: {
        id: session.id,
        userId: session.userId,
        revokedAt: null,
      },
    });

    if (
      !lockedSessionIds.has(session.id) ||
      !currentUser ||
      !currentSession ||
      currentUser.remnashopUserId !== expectedIdentity.remnashopUserId ||
      currentUser.email !== expectedIdentity.email ||
      currentUser.emailVerified !== expectedIdentity.emailVerified ||
      currentUser.telegramId !== expectedIdentity.telegramId ||
      currentUser.authPending !== expectedIdentity.authPending ||
      currentUser.pendingRemnashopUserId !==
        expectedIdentity.pendingRemnashopUserId ||
      currentUser.pendingRemnashopEmail !==
        expectedIdentity.pendingRemnashopEmail ||
      currentSession.remnashopAccessTokenEncrypted !==
        session.remnashopAccessTokenEncrypted ||
      currentSession.remnashopRefreshTokenEncrypted !==
        session.remnashopRefreshTokenEncrypted ||
      !sameInstant(
        currentSession.remnashopAccessExpiresAt,
        session.remnashopAccessExpiresAt,
      ) ||
      !sameInstant(
        currentSession.remnashopRefreshExpiresAt,
        session.remnashopRefreshExpiresAt,
      )
    ) {
      throw ownershipError("local_identity_changed_before_recovery");
    }

    const localMergeOwners = [
      currentTargetOwner,
      currentSourceOwner,
      currentEmailOwner,
    ]
      .filter((owner): owner is NonNullable<typeof owner> => Boolean(owner))
      .filter((owner, index, owners) =>
        owner.id !== session.userId &&
        owners.findIndex(({ id }) => id === owner.id) === index
      );
    const sourceUserIds = localMergeOwners.map(({ id }) => id);

    for (const owner of localMergeOwners) {
      if (
        owner.telegramId &&
        owner.telegramId !== expectedIdentity.telegramId
      ) {
        throw ownershipError("local_owner_has_another_telegram_identity");
      }

      if (
        owner.emailVerified &&
        owner.email &&
        normalizedVerifiedRecoveryEmail &&
        owner.email.trim().toLowerCase() !== normalizedVerifiedRecoveryEmail
      ) {
        throw ownershipError("local_verified_email_conflict");
      }
    }

    const finalEmail = verifiedRecoveryEmail ?? expectedIdentity.email;
    const finalEmailVerified = Boolean(verifiedRecoveryEmail);
    const upstreamOwnerChanging =
      expectedIdentity.remnashopUserId !== initialRemnashopUserId;
    const upstreamMergeRequired = Boolean(
      recoverySourceRemnashopUserId &&
      recoverySourceRemnashopUserId !== initialRemnashopUserId,
    );

    if (
      sourceUserIds.length > 0 ||
      upstreamOwnerChanging ||
      upstreamMergeRequired
    ) {
      const paymentPreflight =
        await preflightPaymentOperationsForUserMerge(
          tx,
          session.userId,
          sourceUserIds,
        );

      if (
        paymentPreflight.targetUpstreamAccountId !==
        expectedIdentity.remnashopUserId
      ) {
        throw ownershipError("payment_owner_changed_before_recovery");
      }
    }

    let auth = initialAuth;
    let profile = initialProfile;
    let remnashopUserId = initialRemnashopUserId;
    let upstreamMerged = false;

    if (
      recoverySourceRemnashopUserId &&
      recoverySourceRemnashopUserId !== remnashopUserId
    ) {
      if (!normalizedExpectedEmail) {
        throw ownershipError("upstream_id_mismatch_without_verified_email");
      }

      const candidateEmail = profile.email?.trim().toLowerCase() ?? null;

      if (candidateEmail && candidateEmail !== normalizedExpectedEmail) {
        throw ownershipError("telegram_candidate_has_another_email");
      }

      const sourceUserId = numericRemnashopUserId(
        recoverySourceRemnashopUserId,
        "source",
      );
      const targetUserId = numericRemnashopUserId(
        remnashopUserId,
        "target",
      );
      const lockedNetworkDeadline = Date.now() + 20_000;
      const nextLockedRequestTimeout = () => {
        const remainingMs = lockedNetworkDeadline - Date.now();

        if (remainingMs <= 100) {
          throw new BffError(
            "UPSTREAM_UNAVAILABLE",
            502,
            "Telegram recovery exceeded its upstream merge deadline",
          );
        }

        return Math.min(8_000, remainingMs);
      };
      let mergeResult: unknown;

      try {
        mergeResult = await remnashopMergeUsers({
          sourceUserId,
          targetUserId,
          reason:
            "Clean Pay Telegram recovery: verified local owner and Telegram identity",
          timeoutMs: nextLockedRequestTimeout(),
        });
      } catch (error) {
        if (error instanceof BffError && error.code === "CONFLICT") {
          throw ownershipError("upstream_merge_conflict");
        }

        throw error;
      }

      if (
        !mergeResult ||
        typeof mergeResult !== "object" ||
        !("dry_run" in mergeResult) ||
        mergeResult.dry_run !== false ||
        !("source_user_id" in mergeResult) ||
        mergeResult.source_user_id !== sourceUserId ||
        !("target_user_id" in mergeResult) ||
        mergeResult.target_user_id !== targetUserId ||
        !("target" in mergeResult) ||
        !mergeResult.target ||
        typeof mergeResult.target !== "object" ||
        !("id" in mergeResult.target) ||
        mergeResult.target.id !== targetUserId ||
        !("conflicts" in mergeResult) ||
        !Array.isArray(mergeResult.conflicts) ||
        mergeResult.conflicts.length !== 0 ||
        !("requires_relogin" in mergeResult) ||
        mergeResult.requires_relogin !== true
      ) {
        throw ownershipError("upstream_merge_result_mismatch");
      }

      auth = await remnashopAuthTelegramIdentity({
        telegramId,
        telegramUsername: session.user.telegramUsername,
        timeoutMs: nextLockedRequestTimeout(),
      });
      remnashopUserId = getRemnashopUserIdFromAccessToken(
        auth.cookies.accessToken,
      );
      profile = await getRemnashopMe(auth.cookies.accessToken, {
        timeoutMs: nextLockedRequestTimeout(),
      });
      assertExpectedTelegramProfile(profile, "after_merge");
      upstreamMerged = true;

      if (remnashopUserId !== initialRemnashopUserId) {
        throw ownershipError("post_merge_telegram_owner_changed");
      }
    }

    if (
      recoverySourceRemnashopUserId &&
      !upstreamMerged &&
      recoverySourceRemnashopUserId !== remnashopUserId
    ) {
      throw ownershipError("upstream_id_mismatch");
    }

    if (
      normalizedExpectedEmail &&
      !profileMatchesExpectedEmail(profile)
    ) {
      throw ownershipError("verified_email_mismatch");
    }

    if (
      finalEmailVerified &&
      (profile.email?.trim().toLowerCase() ?? null) !==
        (finalEmail?.trim().toLowerCase() ?? null)
    ) {
      throw ownershipError("final_local_email_does_not_match_upstream_owner");
    }

    const accessExpiresAt = new Date(auth.data.expires_at);
    const refreshExpiresAt = new Date(auth.data.refresh_expires_at);

    if (
      Number.isNaN(accessExpiresAt.getTime()) ||
      Number.isNaN(refreshExpiresAt.getTime())
    ) {
      throw ownershipError("upstream_auth_expiry_is_invalid");
    }

    if (sourceUserIds.length > 0) {
      await mergeLocalUsersIntoTarget(tx, {
        targetUserId: session.userId,
        targetUpstreamAccountId: remnashopUserId,
        sourceUserIds,
        ownerExpectations: [
          {
            id: currentUser.id,
            remnashopUserId: currentUser.remnashopUserId,
            email: currentUser.email,
            telegramId: currentUser.telegramId,
          },
          ...localMergeOwners.map((owner) => ({
            id: owner.id,
            remnashopUserId: owner.remnashopUserId,
            email: owner.email,
            telegramId: owner.telegramId,
          })),
        ],
      });
    } else if (upstreamOwnerChanging) {
      await transferPaymentOperationsForUserMerge(
        tx,
        session.userId,
        remnashopUserId,
        [],
      );
    }

    if (
      upstreamMerged &&
      lockedSessions.some(({ id }) => id !== session.id)
    ) {
      await tx.webSession.updateMany({
        where: {
          userId: session.userId,
          id: { not: session.id },
          revokedAt: null,
        },
        data: {
          remnashopAccessTokenEncrypted: null,
          remnashopRefreshTokenEncrypted: null,
          remnashopAccessExpiresAt: null,
          remnashopRefreshExpiresAt: null,
        },
      });
    }

    await tx.webUser.update({
      where: { id: session.userId },
      data: {
        remnashopUserId,
        email: finalEmail,
        emailVerified: finalEmailVerified,
        authPending: false,
        pendingRemnashopUserId: null,
        pendingRemnashopEmail: null,
        lastLoginAt: new Date(),
      },
    });
    const stored = await tx.webSession.updateMany({
      where: {
        id: session.id,
        userId: session.userId,
        revokedAt: null,
      },
      data: {
        remnashopAccessTokenEncrypted: protectRemnashopToken(
          auth.cookies.accessToken,
        ),
        remnashopRefreshTokenEncrypted: protectRemnashopToken(
          auth.cookies.refreshToken,
        ),
        remnashopAccessExpiresAt: accessExpiresAt,
        remnashopRefreshExpiresAt: refreshExpiresAt,
      },
    });

    if (stored.count !== 1) {
      throw ownershipError("local_session_changed_during_recovery");
    }

    await assertUserMergeFinalOwner(tx, {
      targetUserId: session.userId,
      sourceUserIds,
      expected: {
        remnashopUserId,
        email: finalEmail,
        telegramId: expectedIdentity.telegramId,
      },
    });

    return {
      auth,
      remnashopUserId,
      finalEmail,
      finalEmailVerified,
      upstreamMerged,
      accessExpiresAt,
      refreshExpiresAt,
    };
  }, {
    maxWait: 5_000,
    timeout: 30_000,
  });
  const {
    auth,
    remnashopUserId,
    finalEmail,
    finalEmailVerified,
    upstreamMerged,
    accessExpiresAt,
    refreshExpiresAt,
  } = recovery;

  authDebugLog("remnashop_telegram_token_restore_success", {
    sessionId: session.id,
    userId: session.userId,
    remnashopUserId,
    upstreamMerged,
    accessExpiresAt,
    refreshExpiresAt,
  });
  logger.info("remnashop_telegram_token_restore_success", {
    sessionId: session.id,
    userId: session.userId,
    remnashopUserId,
    upstreamMerged,
    accessExpiresAt,
    refreshExpiresAt,
  }, {
    category: "auth",
    source: "remnashop.session",
    message: "Restored Remnashop session via Telegram",
  });

  return {
    accessToken: auth.cookies.accessToken,
    refreshToken: auth.cookies.refreshToken,
    session: {
      ...session,
      user: {
        ...session.user,
        remnashopUserId,
        email: finalEmail,
        emailVerified: finalEmailVerified,
        authPending: false,
        pendingRemnashopUserId: null,
        pendingRemnashopEmail: null,
      },
      remnashopAccessTokenEncrypted: protectRemnashopToken(auth.cookies.accessToken),
      remnashopRefreshTokenEncrypted: protectRemnashopToken(auth.cookies.refreshToken),
      remnashopAccessExpiresAt: accessExpiresAt,
      remnashopRefreshExpiresAt: refreshExpiresAt,
    },
  };
}

export async function recoverRemnashopTelegramSession(
  sessionId: string,
  userId: string,
) {
  const session = await prisma.webSession.findFirst({
    where: {
      id: sessionId,
      userId,
      revokedAt: null,
    },
    include: { user: true },
  });

  if (!session) {
    throw new BffError(
      "UNAUTHORIZED",
      401,
      "Telegram recovery session is no longer active.",
    );
  }

  try {
    const recovered = await attachRemnashopTokensForTelegramSession(session);

    if (!recovered) {
      throw new BffError(
        "UPSTREAM_UNAVAILABLE",
        503,
        "Telegram recovery could not obtain a verified Remnashop session.",
      );
    }

    return recovered;
  } catch (error) {
    await prisma.webSession.deleteMany({
      where: { id: sessionId, userId },
    });
    throw error;
  }
}

export async function getAuthorizedRemnashopTokens({
  allowUnverifiedEmail = false,
}: { allowUnverifiedEmail?: boolean } = {}) {
  authDebugLog("remnashop_tokens_authorize_started", { allowUnverifiedEmail });
  const localSession = await getCurrentSession();

  if (!localSession) {
    authDebugLog("remnashop_tokens_authorize_failed", { reason: "missing_session" });
    throw normalizeRemnashopError(401, "Not authenticated", { path: "/auth/session" });
  }

  // Mirror the proxy policy from current database state before token refresh,
  // Telegram recovery or any other upstream side effect. Verification flows
  // opt out explicitly while they are completing that state transition.
  if (!allowUnverifiedEmail) {
    assertEmailVerificationPolicy(localSession.user);
  }

  let authorized: Awaited<ReturnType<typeof acquireRemnashopTokensForSession>> = null;
  let authorizationSource: "stored" | "refresh" | "telegram_restore" | null = null;

  if (
    localSession.user.authPending &&
    localSession.user.telegramId &&
    (
      localSession.user.emailVerified ||
      Boolean(
        localSession.user.pendingRemnashopUserId &&
        localSession.user.pendingRemnashopEmail
      )
    )
  ) {
    const restoredTelegramSession =
      await attachRemnashopTokensForTelegramSession(localSession);

    if (restoredTelegramSession) {
      authorized = {
        ...restoredTelegramSession,
        source: "stored" as const,
      };
      authorizationSource = "telegram_restore";
    }
  }

  if (!authorized) {
    authorized = await acquireRemnashopTokensForSession({
      session: localSession,
      refresh: remnashopRefreshTokens,
    });
    authorizationSource = authorized?.source ?? null;
  }

  if (!authorized && localSession.user.telegramId) {
    // Token acquisition can atomically clear an expired/corrupt legacy bundle.
    // Reload before Telegram recovery so the transaction compares against the
    // committed cleanup rather than the stale request snapshot.
    const recoverySession = await getCurrentSession();

    if (
      !recoverySession ||
      recoverySession.id !== localSession.id ||
      recoverySession.userId !== localSession.userId
    ) {
      throw new BffError(
        "UNAUTHORIZED",
        401,
        "Current session changed before Remnashop recovery",
      );
    }

    const restoredTelegramSession =
      await attachRemnashopTokensForTelegramSession(recoverySession);

    if (restoredTelegramSession) {
      authorized = {
        ...restoredTelegramSession,
        source: "stored" as const,
      };
      authorizationSource = "telegram_restore";
    }
  }

  if (!authorized) {
    authDebugLog("remnashop_tokens_authorize_failed", {
      reason: "session_not_linked_to_remnashop",
      sessionId: localSession.id,
      userId: localSession.userId,
      authMethod: localSession.authMethod,
    });
    throw new BffError(
      "EMAIL_REQUIRED",
      401,
      "Clean Pay session must be linked to Remnashop before using Remnashop actions",
    );
  }

  const { accessToken, refreshToken, session } = authorized;

  authDebugLog("remnashop_tokens_authorize_session_loaded", {
    source: authorizationSource,
    sessionId: session.id,
    userId: session.userId,
    authMethod: session.authMethod,
    remnashopAccessExpiresAt: session.remnashopAccessExpiresAt,
    remnashopRefreshExpiresAt: session.remnashopRefreshExpiresAt,
    allowUnverifiedEmail,
  });

  // Token acquisition (including a required refresh) is deliberately complete
  // before the first /auth/me request, so an expired access token is never used
  // for identity verification.
  if (session.user.email && session.user.emailVerified && !allowUnverifiedEmail) {
    const profile = await getRemnashopMe(accessToken);
    const remnashopEmailMatches = profile.email === session.user.email;

    if (!remnashopEmailMatches || !profile.is_email_verified) {
      authDebugLog("remnashop_tokens_authorize_failed", {
        reason: "account_merge_required",
        sessionId: session.id,
        userId: session.userId,
        localEmail: session.user.email,
        remnashopEmail: profile.email,
        remnashopEmailVerified: profile.is_email_verified,
        hasTelegramId: Boolean(session.user.telegramId),
      });
      throw new BffError(
        "ACCOUNT_MERGE_REQUIRED",
        409,
        "Telegram and e-mail accounts must be merged in Remnashop before payment.",
      );
    }
  }

  if (session.user.email && !session.user.emailVerified && !allowUnverifiedEmail) {
    const profile = await getRemnashopMe(accessToken);
    const remnashopEmailMatches = profile.email === session.user.email;

    if (remnashopEmailMatches && profile.is_email_verified) {
      await prisma.webUser.update({
        where: { id: session.userId },
        data: { emailVerified: true },
      });
      await refreshCurrentAccessCookie();
      session.user.emailVerified = true;
      authDebugLog("remnashop_tokens_authorize_email_verified_synced", {
        sessionId: session.id,
        userId: session.userId,
        email: session.user.email,
      });
    } else {
      authDebugLog("remnashop_tokens_authorize_failed", {
        reason: "email_not_verified",
        sessionId: session.id,
        userId: session.userId,
        hasEmail: true,
        remnashopEmailMatches,
        remnashopEmailVerified: profile.is_email_verified,
      });
      throw new BffError(
        "EMAIL_NOT_VERIFIED",
        403,
        "E-mail must be verified before using Remnashop actions",
      );
    }
  }

  authDebugLog("remnashop_tokens_authorize_success", {
    source: authorizationSource,
    sessionId: session.id,
    userId: session.userId,
    remnashopAccessExpiresAt: session.remnashopAccessExpiresAt,
    remnashopRefreshExpiresAt: session.remnashopRefreshExpiresAt,
  });

  return {
    accessToken,
    refreshToken,
    session,
  };
}
