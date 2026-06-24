import { decryptSecret, encryptSecret } from "@/lib/crypto";
import { authDebugLog } from "@/lib/auth-debug-log";
import { getEnv } from "@/lib/env";
import { logger } from "@/lib/logger";
import { prisma } from "@/lib/prisma";
import {
  BffError,
  normalizeRemnashopError,
  remnashopInvalidJsonError,
  remnashopUnavailableError,
} from "@/lib/remnashop/errors";
import type {
  ChangePasswordRequest,
  ChangePasswordResponse,
  LoginRequest,
  RegisterRequest,
  RemnashopAuthResponse,
  RemnashopMe,
} from "@/lib/remnashop/types";
import { getCurrentSession } from "@/lib/session";

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
    url: endpoint(path),
    headers: init.headers,
    body: init.body ? parseLogBody(init.body) : undefined,
  }, {
    category: "upstream",
    source: "remnashop.client",
    message: `HTTP Request: ${method} ${path}`,
  });

  try {
    const response = await fetch(endpoint(path), init);
    const responseText = await response.clone().text().catch(() => "");

    logger.info("remnashop_response_received", {
      method,
      path,
      status: response.status,
      ok: response.ok,
      durationMs: Date.now() - startedAt,
      headers: Object.fromEntries(response.headers.entries()),
      body: parseLogBody(responseText),
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
      error: error instanceof Error ? error.message : String(error),
    }, {
      category: "upstream",
      source: "remnashop.client",
      message: `HTTP Request failed: ${method} ${path}`,
    });
    throw remnashopUnavailableError(path, error);
  }
}

function parseLogBody(body: BodyInit | string) {
  if (typeof body !== "string") {
    return "[non-string body]";
  }

  if (!body) {
    return null;
  }

  try {
    return JSON.parse(body);
  } catch {
    return body;
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

export async function remnashopAuth(path: "/auth/register" | "/auth/login", body: RegisterRequest | LoginRequest) {
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

export async function getAuthorizedRemnashopTokens({
  allowUnverifiedEmail = false,
}: { allowUnverifiedEmail?: boolean } = {}) {
  authDebugLog("remnashop_tokens_authorize_started", { allowUnverifiedEmail });
  const session = await getCurrentSession();

  if (
    !session?.remnashopAccessTokenEncrypted ||
    !session.remnashopRefreshTokenEncrypted
  ) {
    if (session) {
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

    authDebugLog("remnashop_tokens_authorize_failed", { reason: "missing_session" });
    throw normalizeRemnashopError(401, "Not authenticated", { path: "/auth/session" });
  }

  if (session.user.email && !session.user.emailVerified && !allowUnverifiedEmail) {
    authDebugLog("remnashop_tokens_authorize_failed", {
      reason: "email_not_verified",
      sessionId: session.id,
      userId: session.userId,
      hasEmail: true,
    });
    throw new BffError(
      "EMAIL_NOT_VERIFIED",
      403,
      "E-mail must be verified before using Remnashop actions",
    );
  }

  const refreshToken = revealRemnashopToken(session.remnashopRefreshTokenEncrypted);
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
    accessToken: revealRemnashopToken(session.remnashopAccessTokenEncrypted),
    refreshToken,
    session,
  };
}
