import { createHash, createHmac } from "node:crypto";

import { getEnv } from "@/backend/config/env";
import { ServiceError } from "@/backend/errors/service-error";
import type {
  ChangePasswordRequest,
  ChangePasswordResponse,
  ConfirmPasswordResetRequest,
  LoginRequest,
  NotificationPreferencesResponse,
  RegisterRequest,
  RemnashopAuthResponse,
  RemnashopMe,
  RequestPasswordResetRequest,
  StartGenericEmailAuthRequest,
  TelegramAuthRequest,
  TelegramWebAppAuthRequest,
  UpdateNotificationPreferencesRequest,
} from "@/backend/integrations/remnashop/contracts";
import type {
  RemnashopAuthCookies,
  RemnashopTransport,
} from "@/backend/integrations/remnashop/request-transport";
import { authDebugLog } from "@/backend/observability/auth-debug-log";

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

export function createRemnashopEndpointOperations(
  transport: RemnashopTransport,
) {
  async function remnashopAuth(
    path:
      | "/auth/register"
      | "/auth/login"
      | "/auth/telegram"
      | "/auth/telegram/webapp"
      | "/auth/password/confirm-reset",
    body:
      | RegisterRequest
      | LoginRequest
      | TelegramAuthRequest
      | TelegramWebAppAuthRequest
      | ConfirmPasswordResetRequest,
    { timeoutMs = 15_000 }: { timeoutMs?: number } = {},
  ) {
    const response = await transport.fetchRemnashop(path, {
      method: "POST",
      headers: {
        accept: "application/json",
        "content-type": "application/json",
      },
      body: JSON.stringify(body),
      cache: "no-store",
      signal: AbortSignal.timeout(timeoutMs),
    });
    return transport.consumeRemnashopResponse<
      RemnashopAuthResponse,
      { data: RemnashopAuthResponse; cookies: RemnashopAuthCookies }
    >(
      response,
      transport.safeRequestPath(path),
      {
        method: "POST",
        validateResponse: true,
        complete: (data, authResponse) => ({
          data,
          cookies: transport.extractAuthCookies(authResponse),
        }),
      },
    );
  }

  async function remnashopIdentifyEmail(body: StartGenericEmailAuthRequest) {
    return transport.remnashopValidatedRequest<{ exists: boolean }>(
      "/auth/identify",
      {
        method: "POST",
        body,
      },
    );
  }

  async function remnashopCreateServiceSession(
    body: StartGenericEmailAuthRequest & { user_id: string },
  ) {
    const path = "/auth/service-session";
    const response = await transport.fetchRemnashop(path, {
      method: "POST",
      headers: {
        accept: "application/json",
        "content-type": "application/json",
      },
      body: JSON.stringify(body),
      cache: "no-store",
      signal: AbortSignal.timeout(15_000),
    });
    return transport.consumeRemnashopResponse<
      RemnashopAuthResponse,
      { data: RemnashopAuthResponse; cookies: RemnashopAuthCookies }
    >(response, path, {
      method: "POST",
      validateResponse: true,
      complete: (data, authResponse) => ({
        data,
        cookies: transport.extractAuthCookies(authResponse),
      }),
    });
  }

  async function remnashopRequestPasswordReset(
    body: RequestPasswordResetRequest,
  ) {
    return transport.remnashopValidatedRequest<{ success: boolean }>(
      "/auth/password/request-reset",
      {
        method: "POST",
        body,
      },
    );
  }

  async function remnashopAuthTelegramIdentity({
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
      throw new ServiceError(
        "INTERNAL_ERROR",
        500,
        "TELEGRAM_BOT_TOKEN is required to authenticate Telegram in Remnashop.",
      );
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

  async function remnashopMergeUsers({
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
      throw new ServiceError(
        "INTERNAL_ERROR",
        500,
        "REMNASHOP_API_KEY is required to merge Remnashop users.",
      );
    }

    const path = `/users/merge?dry_run=${dryRun ? "true" : "false"}`;
    const response = await transport.fetchRemnashopAdmin(path, {
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

    return transport.consumeRemnashopResponse<RemnashopMergeUsersResponse>(
      response,
      transport.safeRequestPath(path),
      { method: "POST", validateResponse: true },
    );
  }

  async function remnashopRefreshTokens(
    refreshToken: string,
    timeoutMs = 15_000,
  ) {
    authDebugLog("remnashop_token_refresh_started", {});
    const response = await transport.fetchRemnashop("/auth/refresh", {
      method: "POST",
      headers: {
        accept: "application/json",
        cookie: `refresh_token=${refreshToken}`,
      },
      cache: "no-store",
      signal: AbortSignal.timeout(Math.max(1, Math.min(15_000, timeoutMs))),
    });
    const result = await transport.consumeRemnashopResponse<
      RemnashopAuthResponse,
      { data: RemnashopAuthResponse; cookies: RemnashopAuthCookies }
    >(response, "/auth/refresh", {
      method: "POST",
      validateResponse: true,
      complete: (data, authResponse) => ({
        data,
        cookies: transport.extractAuthCookies(authResponse),
      }),
    });

    authDebugLog("remnashop_token_refresh_success", {
      accessExpiresAt: result.data.expires_at,
      refreshExpiresAt: result.data.refresh_expires_at,
    });

    return result;
  }

  async function remnashopChangePassword(
    accessToken: string,
    body: ChangePasswordRequest,
  ) {
    const response = await transport.fetchRemnashop(
      "/auth/change-password",
      {
        method: "POST",
        headers: {
          accept: "application/json",
          "content-type": "application/json",
          cookie: `access_token=${accessToken}`,
        },
        body: JSON.stringify(body),
        cache: "no-store",
        signal: AbortSignal.timeout(15_000),
      },
    );
    return transport.consumeRemnashopResponse<
      ChangePasswordResponse,
      { data: ChangePasswordResponse; cookies: RemnashopAuthCookies }
    >(response, "/auth/change-password", {
      method: "POST",
      validateResponse: true,
      complete: (data, authResponse) => ({
        data,
        cookies: transport.extractAuthCookies(authResponse),
      }),
    });
  }

  async function getRemnashopMe(
    accessToken: string,
    { timeoutMs }: { timeoutMs?: number } = {},
  ) {
    return transport.remnashopValidatedRequest<RemnashopMe>("/auth/me", {
      accessToken,
      timeoutMs,
    });
  }

  async function getRemnashopNotificationPreferences(
    accessToken: string,
    { timeoutMs = 3_000 }: { timeoutMs?: number } = {},
  ) {
    return transport.remnashopValidatedRequest<
      NotificationPreferencesResponse
    >("/auth/notification-preferences", { accessToken, timeoutMs });
  }

  async function updateRemnashopNotificationPreferences(
    accessToken: string,
    body: UpdateNotificationPreferencesRequest,
  ) {
    return transport.remnashopValidatedRequest<
      NotificationPreferencesResponse
    >("/auth/notification-preferences", {
      method: "PATCH",
      accessToken,
      body,
    });
  }

  async function remnashopLinkTelegram({
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
      throw new ServiceError(
        "INTERNAL_ERROR",
        500,
        "TELEGRAM_BOT_TOKEN is required to link Telegram in Remnashop.",
      );
    }

    const bodyWithoutHash: Omit<TelegramAuthRequest, "hash"> = {
      id: Number(telegramId),
      first_name: telegramUsername || "Telegram",
      username: telegramUsername ?? undefined,
      auth_date: Math.floor(Date.now() / 1000),
    };

    return transport.remnashopValidatedRequest<RemnashopMe>(
      "/auth/telegram/link",
      {
        method: "POST",
        accessToken,
        body: {
          ...bodyWithoutHash,
          hash: signTelegramAuthPayload(bodyWithoutHash, botToken),
        },
      },
    );
  }

  return {
    getRemnashopMe,
    getRemnashopNotificationPreferences,
    remnashopAuth,
    remnashopAuthTelegramIdentity,
    remnashopChangePassword,
    remnashopCreateServiceSession,
    remnashopIdentifyEmail,
    remnashopLinkTelegram,
    remnashopMergeUsers,
    remnashopRefreshTokens,
    remnashopRequestPasswordReset,
    updateRemnashopNotificationPreferences,
  };
}

function signTelegramAuthPayload(
  body: Omit<TelegramAuthRequest, "hash">,
  botToken: string,
) {
  const dataCheckString = Object.entries(body)
    .filter(([, value]) =>
      value !== undefined && value !== null && value !== ""
    )
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, value]) => `${key}=${value}`)
    .join("\n");
  const secret = createHash("sha256").update(botToken).digest();

  return createHmac("sha256", secret)
    .update(dataCheckString)
    .digest("hex");
}
