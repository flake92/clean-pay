import { decryptSecret, encryptSecret } from "@/lib/crypto";
import { getEnv } from "@/lib/env";
import { prisma } from "@/lib/prisma";
import { normalizeRemnashopError } from "@/lib/remnashop/errors";
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

async function parseResponse<T>(response: Response) {
  const text = await response.text();
  const data = text ? JSON.parse(text) : null;

  if (!response.ok) {
    throw normalizeRemnashopError(response.status, data?.detail ?? data);
  }

  return data as T;
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
    throw new Error("Remnashop auth response did not include auth cookies");
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

export function revealRemnashopToken(token: string) {
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

  const response = await fetch(endpoint(path), {
    method: options.method ?? "GET",
    headers,
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
    cache: "no-store",
  });

  return parseResponse<T>(response);
}

export async function remnashopAuth(path: "/auth/register" | "/auth/login", body: RegisterRequest | LoginRequest) {
  const response = await fetch(endpoint(path), {
    method: "POST",
    headers: {
      accept: "application/json",
      "content-type": "application/json",
    },
    body: JSON.stringify(body),
    cache: "no-store",
  });
  const data = await parseResponse<RemnashopAuthResponse>(response);
  const cookies = extractAuthCookies(response);

  return { data, cookies };
}

export async function remnashopRefresh(refreshToken: string) {
  const response = await fetch(endpoint("/auth/refresh"), {
    method: "POST",
    headers: {
      accept: "application/json",
      cookie: `refresh_token=${refreshToken}`,
    },
    cache: "no-store",
  });
  const data = await parseResponse<RemnashopAuthResponse>(response);
  const cookies = extractAuthCookies(response);

  return { data, cookies };
}

export async function remnashopChangePassword(
  accessToken: string,
  body: ChangePasswordRequest,
) {
  const response = await fetch(endpoint("/auth/change-password"), {
    method: "POST",
    headers: {
      accept: "application/json",
      "content-type": "application/json",
      cookie: `access_token=${accessToken}`,
    },
    body: JSON.stringify(body),
    cache: "no-store",
  });
  const data = await parseResponse<ChangePasswordResponse>(response);
  const cookies = extractAuthCookies(response);

  return { data, cookies };
}

export async function getRemnashopMe(accessToken: string) {
  return remnashopRequest<RemnashopMe>("/auth/me", {
    accessToken,
  });
}

export async function getAuthorizedRemnashopTokens() {
  const session = await getCurrentSession();

  if (
    !session?.remnashopAccessTokenEncrypted ||
    !session.remnashopRefreshTokenEncrypted
  ) {
    throw normalizeRemnashopError(401, "Not authenticated");
  }

  const refreshToken = revealRemnashopToken(session.remnashopRefreshTokenEncrypted);
  const refreshThreshold = new Date(Date.now() + 60_000);

  if (
    session.remnashopAccessExpiresAt &&
    session.remnashopAccessExpiresAt <= refreshThreshold
  ) {
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

    return {
      accessToken: refreshed.cookies.accessToken,
      refreshToken: refreshed.cookies.refreshToken,
      session,
    };
  }

  return {
    accessToken: revealRemnashopToken(session.remnashopAccessTokenEncrypted),
    refreshToken,
    session,
  };
}
