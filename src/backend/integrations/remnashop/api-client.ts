import { createHash, createHmac } from "node:crypto";

import { getEnv } from "@/backend/config/env";
import { ServiceError } from "@/backend/errors/service-error";
import type {
  ChangePasswordRequest,
  ConfirmPasswordResetRequest,
  ChangePasswordResponse,
  LoginRequest,
  RegisterRequest,
  RemnashopAuthResponse,
  RemnashopMe,
  StartGenericEmailAuthRequest,
  RequestPasswordResetRequest,
  NotificationPreferencesResponse,
  UpdateNotificationPreferencesRequest,
  TelegramAuthRequest,
  TelegramWebAppAuthRequest,
} from "@/backend/integrations/remnashop/contracts";
import {
  normalizeRemnashopError,
  remnashopInvalidJsonError,
  remnashopUnavailableError,
} from "@/backend/integrations/remnashop/errors";
import { authDebugLog } from "@/backend/observability/auth-debug-log";
import { logger } from "@/backend/observability/logger";
import { recordUpstreamRequest, upstreamOperation } from "@/backend/observability/metrics";
import {
  currentRequestTrace,
  tracedHeaders,
} from "@/backend/observability/request-trace";

export { protectRemnashopToken, revealRemnashopToken } from "@/backend/integrations/remnashop/token-protection";

type RequestOptions = {
  method?: "GET" | "POST" | "PATCH" | "DELETE";
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

const MAX_REMNASHOP_RESPONSE_BYTES = 2 * 1024 * 1024;

function endpoint(path: string) {
  return `${getEnv().remnashopApiBaseUrl}${path}`;
}

function safeRequestPath(path: string) {
  return path.split("?", 1)[0] ?? path;
}

function adminEndpoint(path: string) {
  return `${getEnv().remnashopAdminApiBaseUrl}${path}`;
}

async function readResponseText(response: Response, path: string) {
  const declaredLength = Number(response.headers.get("content-length"));

  if (Number.isFinite(declaredLength) && declaredLength > MAX_REMNASHOP_RESPONSE_BYTES) {
    try {
      await response.body?.cancel("Remnashop response limit exceeded");
    } catch {
      // The response is rejected regardless of whether cancellation succeeds.
    }
    throw remnashopUnavailableError(
      path,
      new Error(`Remnashop response exceeded ${MAX_REMNASHOP_RESPONSE_BYTES} bytes`),
    );
  }

  if (!response.body) {
    return "";
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let receivedBytes = 0;
  let text = "";

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      receivedBytes += value.byteLength;
      if (receivedBytes > MAX_REMNASHOP_RESPONSE_BYTES) {
        try {
          await reader.cancel("Remnashop response limit exceeded");
        } catch {
          // The response is rejected regardless of whether cancellation succeeds.
        }
        throw remnashopUnavailableError(
          path,
          new Error(`Remnashop response exceeded ${MAX_REMNASHOP_RESPONSE_BYTES} bytes`),
        );
      }

      text += decoder.decode(value, { stream: true });
    }

    return text + decoder.decode();
  } catch (error) {
    if (error instanceof ServiceError) throw error;
    throw remnashopUnavailableError(path, error);
  } finally {
    reader.releaseLock();
  }
}

async function parseResponse<T>(response: Response, path: string) {
  const text = await readResponseText(response, path);
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
  const operation = upstreamOperation(safePath);
  const trace = await currentRequestTrace();
  const requestInit = {
    ...init,
    headers: tracedHeaders(init.headers, trace),
  };

  if (safePath.startsWith("/auth/")) {
    const serviceKey = getEnv().remnashopAuthServiceKey;
    if (!serviceKey) {
      throw new ServiceError(
        "INTERNAL_ERROR",
        500,
        "REMNASHOP_AUTH_SERVICE_KEY is required for a Remnashop auth request.",
      );
    }
    requestInit.headers = {
      ...requestInit.headers,
      "x-remnashop-auth-service-key": serviceKey,
    };
  }

  logger.info("remnashop_request_sent", {
    method,
    path: operation,
    hasBody: Boolean(init.body),
    requestId: trace.requestId,
    traceId: trace.traceId,
  }, {
    category: "upstream",
    source: "remnashop.client",
    message: `HTTP Request: ${method} ${operation}`,
  });

  try {
    const response = await fetch(endpoint(path), requestInit);

    const durationMs = Date.now() - startedAt;
    recordUpstreamRequest({
      service: "remnashop",
      operation,
      outcome: response.ok ? "success" : "rejected",
      durationMs,
    });
    logger.info("remnashop_response_received", {
      method,
      path: operation,
      status: response.status,
      ok: response.ok,
      durationMs,
      requestId: trace.requestId,
      traceId: trace.traceId,
    }, {
      category: "upstream",
      source: "remnashop.client",
      message: `HTTP Response: ${method} ${operation} -> ${response.status}`,
    });

    return response;
  } catch (error) {
    const durationMs = Date.now() - startedAt;
    recordUpstreamRequest({
      service: "remnashop",
      operation,
      outcome: "unavailable",
      durationMs,
    });
    logger.error("remnashop_request_failed", {
      method,
      path: operation,
      durationMs,
      errorName: error instanceof Error ? error.name : "UnknownError",
      requestId: trace.requestId,
      traceId: trace.traceId,
    }, {
      category: "upstream",
      source: "remnashop.client",
      message: `HTTP Request failed: ${method} ${operation}`,
    });
    throw remnashopUnavailableError(operation, error);
  }
}

async function fetchRemnashopAdmin(path: string, init: RequestInit) {
  const method = init.method ?? "GET";
  const startedAt = Date.now();
  const safePath = safeRequestPath(path);
  const operation = upstreamOperation(safePath);
  const requestUrl = adminEndpoint(path);
  const trace = await currentRequestTrace();
  const requestInit = {
    ...init,
    headers: tracedHeaders(init.headers, trace),
  };

  logger.info("remnashop_admin_request_sent", {
    method,
    path: operation,
    hasBody: Boolean(init.body),
    requestId: trace.requestId,
    traceId: trace.traceId,
  }, {
    category: "upstream",
    source: "remnashop.client",
    message: `HTTP Request: ${method} admin ${operation}`,
  });

  try {
    const response = await fetch(requestUrl, requestInit);

    const durationMs = Date.now() - startedAt;
    recordUpstreamRequest({
      service: "remnashop_admin",
      operation,
      outcome: response.ok ? "success" : "rejected",
      durationMs,
    });
    logger.info("remnashop_admin_response_received", {
      method,
      path: operation,
      status: response.status,
      ok: response.ok,
      durationMs,
      requestId: trace.requestId,
      traceId: trace.traceId,
    }, {
      category: "upstream",
      source: "remnashop.client",
      message: `HTTP Response: ${method} admin ${operation} -> ${response.status}`,
    });

    return response;
  } catch (error) {
    const durationMs = Date.now() - startedAt;
    recordUpstreamRequest({
      service: "remnashop_admin",
      operation,
      outcome: "unavailable",
      durationMs,
    });
    logger.error("remnashop_admin_request_failed", {
      method,
      path: operation,
      durationMs,
      errorName: error instanceof Error ? error.name : "UnknownError",
      requestId: trace.requestId,
      traceId: trace.traceId,
    }, {
      category: "upstream",
      source: "remnashop.client",
      message: `HTTP Admin request failed: ${method} ${operation}`,
    });
    throw remnashopUnavailableError(operation, error);
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
    throw new ServiceError('UPSTREAM_ERROR', 502, 'Auth response did not include auth cookies', { upstreamPath: '/auth' });
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
    data: await parseResponse<T>(response, upstreamOperation(safeRequestPath(path))),
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
    throw new ServiceError(
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

export async function remnashopAuth(
  path: "/auth/register" | "/auth/login" | "/auth/telegram" | "/auth/telegram/webapp" | "/auth/password/confirm-reset",
  body: RegisterRequest | LoginRequest | TelegramAuthRequest | TelegramWebAppAuthRequest | ConfirmPasswordResetRequest,
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

export async function remnashopIdentifyEmail(body: StartGenericEmailAuthRequest) {
  return remnashopRequest<{ exists: boolean }>("/auth/identify", {
    method: "POST",
    body,
  });
}

export async function remnashopCreateServiceSession(
  body: StartGenericEmailAuthRequest & { user_id: string },
) {
  const path = "/auth/service-session";
  const response = await fetchRemnashop(path, {
    method: "POST",
    headers: {
      accept: "application/json",
      "content-type": "application/json",
    },
    body: JSON.stringify(body),
    cache: "no-store",
    signal: AbortSignal.timeout(15_000),
  });
  const data = await parseResponse<RemnashopAuthResponse>(response, path);
  return { data, cookies: extractAuthCookies(response) };
}

export async function remnashopRequestPasswordReset(
  body: RequestPasswordResetRequest,
) {
  return remnashopRequest<{ success: boolean }>("/auth/password/request-reset", {
    method: "POST",
    body,
  });
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
    throw new ServiceError("INTERNAL_ERROR", 500, "TELEGRAM_BOT_TOKEN is required to authenticate Telegram in Remnashop.");
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
    throw new ServiceError("INTERNAL_ERROR", 500, "REMNASHOP_API_KEY is required to merge Remnashop users.");
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

export async function remnashopRefreshTokens(
  refreshToken: string,
  timeoutMs = 15_000,
) {
  authDebugLog("remnashop_token_refresh_started", {});
  const response = await fetchRemnashop("/auth/refresh", {
    method: "POST",
    headers: {
      accept: "application/json",
      cookie: `refresh_token=${refreshToken}`,
    },
    cache: "no-store",
    signal: AbortSignal.timeout(Math.max(1, Math.min(15_000, timeoutMs))),
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

export async function getRemnashopNotificationPreferences(
  accessToken: string,
  { timeoutMs = 3_000 }: { timeoutMs?: number } = {},
) {
  return remnashopRequest<NotificationPreferencesResponse>(
    "/auth/notification-preferences",
    { accessToken, timeoutMs },
  );
}

export async function updateRemnashopNotificationPreferences(
  accessToken: string,
  body: UpdateNotificationPreferencesRequest,
) {
  return remnashopRequest<NotificationPreferencesResponse>(
    "/auth/notification-preferences",
    { method: "PATCH", accessToken, body },
  );
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
    throw new ServiceError("INTERNAL_ERROR", 500, "TELEGRAM_BOT_TOKEN is required to link Telegram in Remnashop.");
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
