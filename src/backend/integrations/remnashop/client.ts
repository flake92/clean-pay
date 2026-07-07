import { decryptSecret, encryptSecret } from "@/backend/security/crypto";
import { createHash, createHmac } from "node:crypto";
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
import { getCurrentSession, refreshCurrentAccessCookie } from "@/backend/sessions/web-session";

type RequestOptions = {
  method?: "GET" | "POST" | "DELETE";
  body?: unknown;
  accessToken?: string;
  refreshToken?: string;
};

type AuthCookies = {
  accessToken: string;
  refreshToken: string;
};

function endpoint(path: string) {
  return `${getEnv().remnashopApiBaseUrl}${path}`;
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

  logger.info("remnashop_request_sent", {
    method,
    path,
    hasBody: Boolean(init.body),
  }, {
    category: "upstream",
    source: "remnashop.client",
    message: `HTTP Request: ${method} ${path}`,
  });

  try {
    const response = await fetch(endpoint(path), init);

    logger.info("remnashop_response_received", {
      method,
      path,
      status: response.status,
      ok: response.ok,
      durationMs: Date.now() - startedAt,
    }, {
      category: "upstream",
      source: "remnashop.client",
      message: `HTTP Response: ${method} ${path} -> ${response.status}`,
    });

    return response;
  } catch (error) {
    logger.error("remnashop_request_failed", {
      method,
      path,
      durationMs: Date.now() - startedAt,
      errorName: error instanceof Error ? error.name : "UnknownError",
    }, {
      category: "upstream",
      source: "remnashop.client",
      message: `HTTP Request failed: ${method} ${path}`,
    });
    throw remnashopUnavailableError(path, error);
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

export function protectRemnashopToken(token: string) {
  return encryptSecret(token, getEnv().webRefreshSecret);
}

function revealRemnashopToken(token: string) {
  return decryptSecret(token, getEnv().webRefreshSecret);
}

export async function remnashopRequest<T>(path: string, options: RequestOptions = {}) {
  const headers: Record<string, string> = {
    accept: "application/json",
  };

  if (options.body !== undefined) {
    headers["content-type"] = "application/json";
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
  });

  return parseResponse<T>(response, path);
}

export async function remnashopAuth(
  path: "/auth/register" | "/auth/login" | "/auth/telegram" | "/auth/telegram/webapp",
  body: RegisterRequest | LoginRequest | TelegramAuthRequest | TelegramWebAppAuthRequest,
) {
  const response = await fetchRemnashop(path, {
    method: "POST",
    headers: {
      accept: "application/json",
      "content-type": "application/json",
    },
    body: JSON.stringify(body),
    cache: "no-store",
  });
  const data = await parseResponse<RemnashopAuthResponse>(response, path);
  const cookies = extractAuthCookies(response);

  return { data, cookies };
}

async function remnashopRefresh(refreshToken: string) {
  authDebugLog("remnashop_token_refresh_started", {});
  const response = await fetchRemnashop("/auth/refresh", {
    method: "POST",
    headers: {
      accept: "application/json",
      cookie: `refresh_token=${refreshToken}`,
    },
    cache: "no-store",
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
  });
  const data = await parseResponse<ChangePasswordResponse>(response, "/auth/change-password");
  const cookies = extractAuthCookies(response);

  return { data, cookies };
}

export async function getRemnashopMe(accessToken: string) {
  return remnashopRequest<RemnashopMe>("/auth/me", {
    accessToken,
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

async function attachRemnashopTokensForTelegramSession(
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

  const bodyWithoutHash: Omit<TelegramAuthRequest, "hash"> = {
    id: Number(telegramId),
    first_name: session.user.telegramUsername || "Telegram",
    username: session.user.telegramUsername ?? undefined,
    auth_date: Math.floor(Date.now() / 1000),
  };
  const auth = await remnashopAuth("/auth/telegram", {
    ...bodyWithoutHash,
    hash: signTelegramAuthPayload(bodyWithoutHash, env.telegramBotToken),
  });
  const remnashopUserId = getRemnashopUserIdFromAccessToken(auth.cookies.accessToken);
  const accessExpiresAt = new Date(auth.data.expires_at);
  const refreshExpiresAt = new Date(auth.data.refresh_expires_at);

  await prisma.$transaction(async (tx) => {
    await tx.webUser.update({
      where: { id: session.userId },
      data: { remnashopUserId },
    });
    await tx.webSession.update({
      where: { id: session.id },
      data: {
        remnashopAccessTokenEncrypted: protectRemnashopToken(auth.cookies.accessToken),
        remnashopRefreshTokenEncrypted: protectRemnashopToken(auth.cookies.refreshToken),
        remnashopAccessExpiresAt: accessExpiresAt,
        remnashopRefreshExpiresAt: refreshExpiresAt,
      },
    });
  });

  authDebugLog("remnashop_telegram_token_restore_success", {
    sessionId: session.id,
    userId: session.userId,
    remnashopUserId,
    accessExpiresAt,
    refreshExpiresAt,
  });
  logger.info("remnashop_telegram_token_restore_success", {
    sessionId: session.id,
    userId: session.userId,
    remnashopUserId,
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
      remnashopAccessTokenEncrypted: protectRemnashopToken(auth.cookies.accessToken),
      remnashopRefreshTokenEncrypted: protectRemnashopToken(auth.cookies.refreshToken),
      remnashopAccessExpiresAt: accessExpiresAt,
      remnashopRefreshExpiresAt: refreshExpiresAt,
    },
  };
}

export async function getAuthorizedRemnashopTokens({
  allowUnverifiedEmail = false,
}: { allowUnverifiedEmail?: boolean } = {}) {
  authDebugLog("remnashop_tokens_authorize_started", { allowUnverifiedEmail });
  const session = await getCurrentSession();

  if (!session) {
    authDebugLog("remnashop_tokens_authorize_failed", { reason: "missing_session" });
    throw normalizeRemnashopError(401, "Not authenticated", { path: "/auth/session" });
  }

  if (
    !session.remnashopAccessTokenEncrypted ||
    !session.remnashopRefreshTokenEncrypted
  ) {
    const restoredTelegramSession = await attachRemnashopTokensForTelegramSession(session);

    if (restoredTelegramSession) {
      return restoredTelegramSession;
    }

    authDebugLog("remnashop_tokens_authorize_failed", {
      reason: "session_not_linked_to_remnashop",
      sessionId: session.id,
      userId: session.userId,
      authMethod: session.authMethod,
    });
    throw new BffError(
      "EMAIL_REQUIRED",
      401,
      "Clean Pay session must be linked to Remnashop before using Remnashop actions",
    );
  }

  const encryptedAccessToken = session.remnashopAccessTokenEncrypted;
  const encryptedRefreshToken = session.remnashopRefreshTokenEncrypted;

  if (!encryptedAccessToken || !encryptedRefreshToken) {
    throw new BffError("EMAIL_REQUIRED", 401, "Clean Pay session must be linked to Remnashop before using Remnashop actions");
  }

  const refreshToken = revealRemnashopToken(encryptedRefreshToken);
  const accessToken = revealRemnashopToken(encryptedAccessToken);

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

  const refreshThreshold = new Date(Date.now() + 60_000);

  authDebugLog("remnashop_tokens_authorize_session_loaded", {
    sessionId: session.id,
    userId: session.userId,
    authMethod: session.authMethod,
    remnashopAccessExpiresAt: session.remnashopAccessExpiresAt,
    remnashopRefreshExpiresAt: session.remnashopRefreshExpiresAt,
    allowUnverifiedEmail,
  });

  if (
    session.remnashopAccessExpiresAt &&
    session.remnashopAccessExpiresAt <= refreshThreshold
  ) {
    authDebugLog("remnashop_tokens_refresh_required", {
      sessionId: session.id,
      userId: session.userId,
      remnashopAccessExpiresAt: session.remnashopAccessExpiresAt,
      threshold: refreshThreshold,
    });
    const refreshed = await remnashopRefresh(refreshToken);

    await prisma.webSession.update({
      where: { id: session.id },
      data: {
        remnashopAccessTokenEncrypted: protectRemnashopToken(
          refreshed.cookies.accessToken,
        ),
        remnashopRefreshTokenEncrypted: protectRemnashopToken(
          refreshed.cookies.refreshToken,
        ),
        remnashopAccessExpiresAt: new Date(refreshed.data.expires_at),
        remnashopRefreshExpiresAt: new Date(refreshed.data.refresh_expires_at),
      },
    });

    authDebugLog("remnashop_tokens_authorize_success", {
      source: "refresh",
      sessionId: session.id,
      userId: session.userId,
      remnashopAccessExpiresAt: refreshed.data.expires_at,
      remnashopRefreshExpiresAt: refreshed.data.refresh_expires_at,
    });

    return {
      accessToken: refreshed.cookies.accessToken,
      refreshToken: refreshed.cookies.refreshToken,
      session,
    };
  }

  authDebugLog("remnashop_tokens_authorize_success", {
    source: "stored",
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
