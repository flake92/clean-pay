import { createRemoteJWKSet, customFetch, jwtVerify } from "jose";

import { getEnv } from "@/backend/config/env";
import {
  cancelUpstreamResponseBody,
  credentialedFetch,
  readBoundedJsonFromUnknown,
  readBoundedResponseText,
} from "@/backend/integrations/http/upstream-http";
import { remnashopAuth } from "@/backend/integrations/remnashop/client";
import type { TelegramAuthRequest } from "@/backend/integrations/remnashop/contracts";
import {
  decodeTelegramJwks,
  decodeTelegramTokenResponse,
  normalizeTelegramOidcClientSecret,
  signTelegramAuthPayload,
} from "@/backend/integrations/telegram/oidc-codec";
import { logTechnicalError, logTechnicalWarning } from "@/backend/observability/audit";
import { authDebugLog } from "@/backend/observability/auth-debug-log";
import { logger } from "@/backend/observability/logger";
import { recordUpstreamRequest } from "@/backend/observability/metrics";
import {
  currentRequestTrace,
  tracedHeaders,
} from "@/backend/observability/request-trace";

const maxTelegramTokenResponseBytes = 64 * 1024;
const maxTelegramJwksResponseBytes = 1024 * 1024;

async function fetchTelegramJwks(
  url: string,
  options: {
    headers: Headers;
    method: "GET";
    signal: AbortSignal;
  },
) {
  const startedAt = Date.now();
  let outcome: "success" | "rejected" | "unavailable" = "unavailable";

  try {
    const response = await credentialedFetch(url, {
      method: options.method,
      headers: options.headers,
      signal: options.signal,
    });

    if (response.status !== 200) {
      outcome = "rejected";
      await cancelUpstreamResponseBody(response);
      return response;
    }

    const jwks = decodeTelegramJwks(
      await readBoundedJsonFromUnknown(response, {
        maxBytes: maxTelegramJwksResponseBytes,
      }),
    );
    outcome = "success";
    return new Response(JSON.stringify(jwks), {
      status: response.status,
      statusText: response.statusText,
      headers: { "content-type": "application/json" },
    });
  } finally {
    recordUpstreamRequest({
      service: "telegram_oidc",
      operation: "/.well-known/jwks.json",
      outcome,
      durationMs: Date.now() - startedAt,
    });
  }
}

let cachedTelegramJwks: {
  uri: string;
  value: ReturnType<typeof createRemoteJWKSet>;
} | null = null;

export async function exchangeTelegramCodeForIdToken(
  code: string,
  codeVerifier: string,
) {
  const env = getEnv();
  authDebugLog("telegram_oidc_token_exchange_started", {
    tokenEndpoint: env.telegramOidc.tokenEndpoint,
    redirectUri: env.telegramOidc.redirectUri,
    hasCode: Boolean(code),
    hasVerifier: Boolean(codeVerifier),
  });
  const body = new URLSearchParams({
    grant_type: "authorization_code",
    code,
    redirect_uri: env.telegramOidc.redirectUri,
    client_id: env.telegramOidc.clientId,
    code_verifier: codeVerifier,
  });
  const clientSecret = normalizeTelegramOidcClientSecret(
    env.telegramOidc.clientId,
    env.telegramOidc.clientSecret,
  );
  const basicAuth = Buffer
    .from(`${env.telegramOidc.clientId}:${clientSecret}`)
    .toString("base64");
  const startedAt = Date.now();

  logger.info("telegram_token_request_sent", {
    method: "POST",
    hasBody: true,
  }, {
    category: "upstream",
    source: "telegram.oidc",
    message: "HTTP Request: POST Telegram OIDC token",
  });

  const trace = await currentRequestTrace();
  let response: Response | undefined;
  let outcome: "success" | "rejected" | "unavailable" = "unavailable";
  try {
    response = await credentialedFetch(env.telegramOidc.tokenEndpoint, {
      method: "POST",
      headers: tracedHeaders({
        "content-type": "application/x-www-form-urlencoded",
        authorization: `Basic ${basicAuth}`,
      }, trace),
      body,
      cache: "no-store",
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) {
      const responseText = await readBoundedResponseText(response, {
        maxBytes: maxTelegramTokenResponseBytes,
      }).catch(() => "");
      outcome = "rejected";
      logTechnicalWarning("telegram_token_exchange_failed", {
        status: response.status,
        statusText: response.statusText,
        hasBody: Boolean(responseText),
      });
      throw new Error("Telegram token exchange failed");
    }

    let tokenSet;
    try {
      tokenSet = decodeTelegramTokenResponse(
        await readBoundedJsonFromUnknown(response, {
          maxBytes: maxTelegramTokenResponseBytes,
        }),
      );
    } catch (error) {
      throw new Error("Telegram token exchange returned an invalid response", { cause: error });
    }

    logger.info("telegram_token_response_received", {
      method: "POST",
      status: response.status,
      ok: response.ok,
      durationMs: Date.now() - startedAt,
    }, {
      category: "upstream",
      source: "telegram.oidc",
      message: `HTTP Response: POST Telegram OIDC token -> ${response.status}`,
    });

    if (tokenSet.error) {
      outcome = "rejected";
      logTechnicalWarning("telegram_token_exchange_error_response", {
        error: tokenSet.error,
        errorDescription: tokenSet.error_description ?? null,
      });
      throw new Error(`Telegram token exchange failed: ${tokenSet.error}`);
    }
    if (!tokenSet.id_token) {
      throw new Error("Telegram token response does not contain id_token");
    }

    outcome = "success";
    authDebugLog("telegram_oidc_token_exchange_success", { hasIdToken: true });
    return tokenSet.id_token;
  } catch (error) {
    if (response) {
      throw error;
    }
    logger.error("telegram_token_request_failed", {
      method: "POST",
      durationMs: Date.now() - startedAt,
      errorName: error instanceof Error ? error.name : "UnknownError",
    }, {
      category: "upstream",
      source: "telegram.oidc",
      message: "HTTP Request failed: POST Telegram OIDC token",
    });
    throw new Error("Telegram token exchange unavailable", { cause: error });
  } finally {
    recordUpstreamRequest({
      service: "telegram_oidc",
      operation: "/token",
      outcome,
      durationMs: Date.now() - startedAt,
    });
  }
}

export async function verifyTelegramIdToken(idToken: string, nonce: string) {
  const env = getEnv();
  authDebugLog("telegram_oidc_id_token_verify_started", {
    issuer: env.telegramOidc.issuer,
    audience: env.telegramOidc.clientId,
    jwksUri: env.telegramOidc.jwksUri,
  });
  if (cachedTelegramJwks?.uri !== env.telegramOidc.jwksUri) {
    cachedTelegramJwks = {
      uri: env.telegramOidc.jwksUri,
      value: createRemoteJWKSet(new URL(env.telegramOidc.jwksUri), {
        [customFetch]: fetchTelegramJwks,
      }),
    };
  }
  const result = await jwtVerify(idToken, cachedTelegramJwks.value, {
    issuer: env.telegramOidc.issuer,
    audience: env.telegramOidc.clientId,
  });
  if (result.payload.nonce !== nonce) {
    throw new Error("Telegram id_token nonce mismatch");
  }

  authDebugLog("telegram_oidc_id_token_verify_success", {
    issuer: result.payload.iss,
    audience: result.payload.aud,
    expiresAtEpochSeconds: result.payload.exp,
    hasNonce: Boolean(result.payload.nonce),
  });
  return result.payload;
}

export function resetTelegramOidcJwksForTests() {
  cachedTelegramJwks = null;
}

export async function authenticateRemnashopWithTelegramIdentity(identity: {
  telegramId: string;
  telegramUsername: string | null;
  fullName: string | null;
  photoUrl: string | null;
}, options: { failClosed?: boolean } = {}) {
  const env = getEnv();
  if (!env.telegramBotToken) {
    logTechnicalWarning("telegram_remnashop_auth_skipped", {
      reason: "missing_telegram_bot_token",
      telegramId: identity.telegramId,
    });
    return null;
  }

  const nameParts = identity.fullName?.trim().split(/\s+/).filter(Boolean) ?? [];
  const firstName = nameParts[0] ?? identity.telegramUsername ?? "Telegram";
  const lastName = nameParts.length > 1 ? nameParts.slice(1).join(" ") : undefined;
  const bodyWithoutHash: Omit<TelegramAuthRequest, "hash"> = {
    id: Number(identity.telegramId),
    first_name: firstName,
    last_name: lastName,
    username: identity.telegramUsername ?? undefined,
    photo_url: identity.photoUrl ?? undefined,
    auth_date: Math.floor(Date.now() / 1000),
  };

  try {
    return await remnashopAuth("/auth/telegram", {
      ...bodyWithoutHash,
      hash: signTelegramAuthPayload(bodyWithoutHash, env.telegramBotToken),
    });
  } catch (error) {
    logTechnicalError("telegram_remnashop_auth_failed", error, {
      telegramId: identity.telegramId,
      hasUsername: Boolean(identity.telegramUsername),
    });
    if (options.failClosed) throw error;
    return null;
  }
}

export async function authenticateRemnashopWithTelegramPayload(
  payload: TelegramAuthRequest,
) {
  try {
    return await remnashopAuth("/auth/telegram", payload);
  } catch (error) {
    logTechnicalError("telegram_remnashop_auth_failed", error, {
      telegramId: payload.id.toString(),
      hasUsername: Boolean(payload.username),
    });
    return null;
  }
}
