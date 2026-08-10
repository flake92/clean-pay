import { createHash, createHmac } from "node:crypto";
import type { JWTPayload } from "jose";
import { createRemoteJWKSet, jwtVerify } from "jose";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";

import { logTechnicalError, logTechnicalWarning } from "@/backend/observability/audit";
import { authDebugLog } from "@/backend/observability/auth-debug-log";
import { randomToken, safeEqual, sha256 } from "@/backend/security/crypto";
import { redisCommand } from "@/backend/cache/redis";
import { getEnv } from "@/backend/config/env";
import { logger } from "@/backend/observability/logger";
import { recordUpstreamRequest } from "@/backend/observability/metrics";
import {
  currentRequestTrace,
  tracedHeaders,
} from "@/backend/observability/request-trace";
import { prisma } from "@/backend/database/prisma";
import { claimTelegramAuthState as claimTelegramAuthStateRecord } from "@/backend/auth/one-time-state";
import { remnashopAuth } from "@/backend/integrations/remnashop/client";
import { ServiceError } from "@/backend/errors/service-error";
import { getCurrentSession } from "@/backend/integrations/sessions/web-session-service";
import type { TelegramAuthRequest } from "@/backend/integrations/remnashop/contracts";

const telegramAuthTtlSeconds = 10 * 60;
const telegramLoginAuthMaxAgeSeconds = 5 * 60;
const telegramLoginClockSkewSeconds = 30;

export class TelegramAuthStateAlreadyConsumedError extends Error {
  constructor() {
    super("Telegram auth state was already consumed or has expired");
    this.name = "TelegramAuthStateAlreadyConsumedError";
  }
}

const telegramOidcCookieNames = {
  state: "clean_pay_tg_state",
  nonce: "clean_pay_tg_nonce",
  codeVerifier: "clean_pay_tg_code_verifier",
} as const;

type TelegramCookieStore = Awaited<ReturnType<typeof cookies>>;

function clearTemporaryTelegramAuthCookies(cookieStore: TelegramCookieStore) {
  cookieStore.delete(telegramOidcCookieNames.state);
  cookieStore.delete(telegramOidcCookieNames.nonce);
  cookieStore.delete(telegramOidcCookieNames.codeVerifier);
}

export async function clearTelegramAuthCookies() {
  clearTemporaryTelegramAuthCookies(await cookies());
}

function addSeconds(date: Date, seconds: number) {
  return new Date(date.getTime() + seconds * 1000);
}

function temporaryCookieOptions() {
  const env = getEnv();

  return {
    httpOnly: true,
    secure: env.cookieSecure,
    sameSite: env.cookieSameSite,
    path: "/",
    maxAge: telegramAuthTtlSeconds,
  } as const;
}

export async function createTelegramAuthorizationResponse(
  redirectTo?: string,
  userId?: string,
) {
  const env = getEnv();
  authDebugLog("telegram_oidc_start_started", {
    hasRedirectTo: Boolean(redirectTo),
    linkUserId: userId,
  });
  const state = randomToken();
  const nonce = randomToken();
  const codeVerifier = randomToken(64);
  const codeChallenge = sha256(codeVerifier);

  await prisma.telegramAuthState.create({
    data: {
      stateHash: sha256(state),
      nonceHash: sha256(nonce),
      codeVerifierHash: sha256(codeVerifier),
      redirectTo,
      userId,
      expiresAt: addSeconds(new Date(), telegramAuthTtlSeconds),
    },
  });
  authDebugLog("telegram_oidc_state_created", {
    linkUserId: userId,
    expiresInSeconds: telegramAuthTtlSeconds,
    hasRedirectTo: Boolean(redirectTo),
  });

  const authorizationUrl = new URL(env.telegramOidc.authorizationEndpoint);
  authorizationUrl.searchParams.set("response_type", "code");
  authorizationUrl.searchParams.set("client_id", env.telegramOidc.clientId);
  authorizationUrl.searchParams.set("redirect_uri", env.telegramOidc.redirectUri);
  authorizationUrl.searchParams.set("scope", "openid profile");
  authorizationUrl.searchParams.set("state", state);
  authorizationUrl.searchParams.set("nonce", nonce);
  authorizationUrl.searchParams.set("code_challenge", codeChallenge);
  authorizationUrl.searchParams.set("code_challenge_method", "S256");

  const response = NextResponse.redirect(authorizationUrl);
  const cookieOptions = temporaryCookieOptions();

  response.cookies.set(telegramOidcCookieNames.state, state, cookieOptions);
  response.cookies.set(telegramOidcCookieNames.nonce, nonce, cookieOptions);
  response.cookies.set(
    telegramOidcCookieNames.codeVerifier,
    codeVerifier,
    cookieOptions,
  );

  authDebugLog("telegram_oidc_redirect_created", {
    authorizationEndpoint: env.telegramOidc.authorizationEndpoint,
    clientId: env.telegramOidc.clientId,
    redirectUri: env.telegramOidc.redirectUri,
    hasRedirectTo: Boolean(redirectTo),
    linkUserId: userId,
  });

  return response;
}

export async function createTelegramPopupStartResponse(
  redirectTo?: string,
  userId?: string,
) {
  const env = getEnv();
  const state = randomToken();
  const nonce = randomToken();
  const codeVerifier = randomToken(64);

  await prisma.telegramAuthState.create({
    data: {
      stateHash: sha256(state),
      nonceHash: sha256(nonce),
      codeVerifierHash: sha256(codeVerifier),
      redirectTo,
      userId,
      expiresAt: addSeconds(new Date(), telegramAuthTtlSeconds),
    },
  });

  const response = NextResponse.json({
    clientId: env.telegramOidc.clientId,
    nonce,
    redirectUri: env.telegramOidc.redirectUri,
  });
  const cookieOptions = temporaryCookieOptions();

  response.cookies.set(telegramOidcCookieNames.state, state, cookieOptions);
  response.cookies.set(telegramOidcCookieNames.nonce, nonce, cookieOptions);
  response.cookies.set(
    telegramOidcCookieNames.codeVerifier,
    codeVerifier,
    cookieOptions,
  );

  return response;
}

async function exchangeCodeForIdToken(code: string, codeVerifier: string) {
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
  let response: Response;
  try {
    response = await fetch(env.telegramOidc.tokenEndpoint, {
      method: "POST",
      headers: tracedHeaders({
        "content-type": "application/x-www-form-urlencoded",
        authorization: `Basic ${basicAuth}`,
      }, trace),
      body,
      cache: "no-store",
      signal: AbortSignal.timeout(10_000),
    });
  } catch (error) {
    recordUpstreamRequest({
      service: "telegram_oidc",
      operation: "/token",
      outcome: "unavailable",
      durationMs: Date.now() - startedAt,
    });
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
  }
  const responseText = await response.clone().text().catch(() => "");

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

  if (!response.ok) {
    recordUpstreamRequest({
      service: "telegram_oidc",
      operation: "/token",
      outcome: "rejected",
      durationMs: Date.now() - startedAt,
    });
    const errorBody = responseText || null;

    logTechnicalWarning("telegram_token_exchange_failed", {
      status: response.status,
      statusText: response.statusText,
      hasBody: Boolean(errorBody),
    });

    throw new Error("Telegram token exchange failed");
  }

  let tokenSet: { id_token?: string; error?: string; error_description?: string };
  try {
    tokenSet = JSON.parse(responseText) as typeof tokenSet;
  } catch (error) {
    recordUpstreamRequest({
      service: "telegram_oidc",
      operation: "/token",
      outcome: "unavailable",
      durationMs: Date.now() - startedAt,
    });
    throw new Error("Telegram token exchange returned an invalid response", { cause: error });
  }

  if (tokenSet.error) {
    recordUpstreamRequest({
      service: "telegram_oidc",
      operation: "/token",
      outcome: "rejected",
      durationMs: Date.now() - startedAt,
    });
    logTechnicalWarning("telegram_token_exchange_error_response", {
      error: tokenSet.error,
      errorDescription: tokenSet.error_description ?? null,
    });

    throw new Error(`Telegram token exchange failed: ${tokenSet.error}`);
  }

  if (!tokenSet.id_token) {
    recordUpstreamRequest({
      service: "telegram_oidc",
      operation: "/token",
      outcome: "unavailable",
      durationMs: Date.now() - startedAt,
    });
    throw new Error("Telegram token response does not contain id_token");
  }

  recordUpstreamRequest({
    service: "telegram_oidc",
    operation: "/token",
    outcome: "success",
    durationMs: Date.now() - startedAt,
  });

  authDebugLog("telegram_oidc_token_exchange_success", { hasIdToken: true });

  return tokenSet.id_token;
}

function normalizeTelegramOidcClientSecret(clientId: string, clientSecret: string) {
  const tokenPrefix = `${clientId}:`;

  if (clientSecret.startsWith(tokenPrefix)) {
    return clientSecret.slice(tokenPrefix.length);
  }

  return clientSecret;
}

async function verifyTelegramIdToken(idToken: string, nonce: string) {
  const env = getEnv();
  authDebugLog("telegram_oidc_id_token_verify_started", {
    issuer: env.telegramOidc.issuer,
    audience: env.telegramOidc.clientId,
    jwksUri: env.telegramOidc.jwksUri,
  });
  const jwks = createRemoteJWKSet(new URL(env.telegramOidc.jwksUri));
  const result = await jwtVerify(idToken, jwks, {
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

function getTelegramId(payload: JWTPayload) {
  const rawTelegramId = payload.id ?? payload.telegram_id;

  if (
    typeof rawTelegramId !== "string" &&
    typeof rawTelegramId !== "number"
  ) {
    throw new Error("Telegram id_token does not contain Telegram user id");
  }

  const telegramId = BigInt(rawTelegramId);

  if (telegramId <= BigInt(0)) {
    throw new Error("Telegram id_token contains invalid telegram_id");
  }

  return telegramId.toString();
}

function getFullName(payload: JWTPayload) {
  if (typeof payload.name === "string") {
    return payload.name;
  }

  const parts = [payload.given_name, payload.family_name].filter(
    (part): part is string => typeof part === "string" && part.length > 0,
  );

  return parts.length > 0 ? parts.join(" ") : null;
}

function getTelegramNameParts(payload: JWTPayload, fallbackUsername: string | null) {
  const firstName =
    typeof payload.given_name === "string" && payload.given_name.trim()
      ? payload.given_name.trim()
      : typeof payload.name === "string" && payload.name.trim()
        ? payload.name.trim().split(/\s+/)[0] ?? "Telegram"
        : fallbackUsername ?? "Telegram";
  const lastName =
    typeof payload.family_name === "string" && payload.family_name.trim()
      ? payload.family_name.trim()
      : undefined;

  return { firstName, lastName };
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

type TelegramLoginWidgetPayload = Partial<TelegramAuthRequest> & {
  hash?: string | null;
};

function verifyTelegramLoginWidgetPayload(payload: TelegramLoginWidgetPayload) {
  const env = getEnv();

  if (!env.telegramBotToken) {
    throw new Error("TELEGRAM_BOT_TOKEN is required for Telegram Login widget");
  }

  if (!payload.hash) {
    throw new Error("Telegram Login payload does not contain hash");
  }

  if (!payload.id || !payload.auth_date) {
    throw new Error("Telegram Login payload is incomplete");
  }

  const authDate = Number(payload.auth_date);

  if (!Number.isFinite(authDate) || authDate <= 0) {
    throw new Error("Telegram Login payload contains invalid auth_date");
  }

  const now = Math.floor(Date.now() / 1000);

  if (
    authDate - now > telegramLoginClockSkewSeconds
    || now - authDate > telegramLoginAuthMaxAgeSeconds
  ) {
    throw new Error("Telegram Login payload is expired");
  }

  const bodyWithoutHash: Omit<TelegramAuthRequest, "hash"> = {
    id: Number(payload.id),
    first_name: payload.first_name ?? "Telegram",
    last_name: payload.last_name,
    username: payload.username,
    photo_url: payload.photo_url,
    auth_date: authDate,
  };
  const expectedHash = signTelegramAuthPayload(bodyWithoutHash, env.telegramBotToken);

  if (!safeEqual(expectedHash, payload.hash)) {
    throw new Error("Telegram Login payload hash is invalid");
  }

  return {
    ...bodyWithoutHash,
    hash: payload.hash,
  };
}

async function claimTelegramLoginWidgetPayload(payload: TelegramAuthRequest) {
  const ageSeconds = Math.max(
    0,
    Math.floor(Date.now() / 1000) - Number(payload.auth_date),
  );
  const ttlSeconds = Math.max(1, telegramLoginAuthMaxAgeSeconds - ageSeconds);
  const claimed = await redisCommand([
    "SET",
    `clean-pay:telegram-widget:v1:${sha256(payload.hash)}`,
    "1",
    "NX",
    "EX",
    ttlSeconds,
  ]);

  if (claimed !== "OK") {
    throw new Error("Telegram Login payload was already used");
  }
}

async function authenticateRemnashopWithTelegram(payload: JWTPayload, telegramId: string, telegramUsername: string | null) {
  const env = getEnv();

  if (!env.telegramBotToken) {
    logTechnicalWarning("telegram_remnashop_auth_skipped", {
      reason: "missing_telegram_bot_token",
      telegramId,
    });
    return null;
  }

  const { firstName, lastName } = getTelegramNameParts(payload, telegramUsername);
  const bodyWithoutHash: Omit<TelegramAuthRequest, "hash"> = {
    id: Number(telegramId),
    first_name: firstName,
    last_name: lastName,
    username: telegramUsername ?? undefined,
    photo_url: typeof payload.picture === "string" ? payload.picture : undefined,
    auth_date: Math.floor(Date.now() / 1000),
  };

  try {
    return await remnashopAuth("/auth/telegram", {
      ...bodyWithoutHash,
      hash: signTelegramAuthPayload(bodyWithoutHash, env.telegramBotToken),
    });
  } catch (error) {
    logTechnicalError("telegram_remnashop_auth_failed", error, {
      telegramId,
      hasUsername: Boolean(telegramUsername),
    });
    return null;
  }
}

async function authenticateRemnashopWithTelegramPayload(payload: TelegramAuthRequest) {
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

export async function verifyTelegramCallback(code: string, state: string) {
  const cookieStore = await cookies();
  const cookieState = cookieStore.get(telegramOidcCookieNames.state)?.value;
  const nonce = cookieStore.get(telegramOidcCookieNames.nonce)?.value;
  const codeVerifier = cookieStore.get(
    telegramOidcCookieNames.codeVerifier,
  )?.value;

  authDebugLog("telegram_oidc_callback_consume_started", {
    hasCode: Boolean(code),
    hasStateParam: Boolean(state),
    hasStateCookie: Boolean(cookieState),
    hasNonceCookie: Boolean(nonce),
    hasCodeVerifierCookie: Boolean(codeVerifier),
  });

  if (!cookieState || cookieState !== state || !nonce || !codeVerifier) {
    logTechnicalWarning("telegram_oidc_state_cookie_invalid", {
      storedStatePresent: Boolean(cookieState),
      stateMatches: Boolean(cookieState && cookieState === state),
      hasNonce: Boolean(nonce),
      verifierPresent: Boolean(codeVerifier),
    });

    throw new Error("Telegram OIDC state is invalid");
  }
  authDebugLog("telegram_oidc_callback_cookies_valid", {
    stateMatches: true,
    hasNonceCookie: true,
    hasCodeVerifierCookie: true,
  });

  const authState = await prisma.telegramAuthState.findFirst({
    where: {
      stateHash: sha256(state),
      nonceHash: sha256(nonce),
      codeVerifierHash: sha256(codeVerifier),
      consumedAt: null,
      expiresAt: { gt: new Date() },
    },
  });

  if (!authState) {
    logTechnicalWarning("telegram_oidc_state_not_found", {
      stateParamPresent: Boolean(state),
      hasNonce: Boolean(nonce),
      verifierPresent: Boolean(codeVerifier),
    });

    throw new Error("Telegram OIDC state was not found or has expired");
  }
  authDebugLog("telegram_oidc_state_loaded", {
    authStateId: authState.id,
    linkUserId: authState.userId,
    hasRedirectTo: Boolean(authState.redirectTo),
    expiresAt: authState.expiresAt,
  });

  await assertTelegramLinkSession(authState, cookieStore);

  const idToken = await exchangeCodeForIdToken(code, codeVerifier);

  return verifyTelegramIdTokenForState(idToken, {
    authState,
    nonce,
    cookieStore,
  });
}

export async function verifyTelegramPopupToken(idToken: string) {
  const cookieStore = await cookies();
  const nonce = cookieStore.get(telegramOidcCookieNames.nonce)?.value;

  authDebugLog("telegram_popup_callback_consume_started", {
    hasIdToken: Boolean(idToken),
    hasNonceCookie: Boolean(nonce),
  });

  if (!nonce) {
    logTechnicalWarning("telegram_popup_nonce_cookie_invalid", {
      hasNonce: false,
    });

    throw new Error("Telegram popup nonce is invalid");
  }

  const authState = await prisma.telegramAuthState.findFirst({
    where: {
      nonceHash: sha256(nonce),
      consumedAt: null,
      expiresAt: { gt: new Date() },
    },
  });

  if (!authState) {
    logTechnicalWarning("telegram_popup_state_not_found", {
      hasNonce: true,
    });

    throw new Error("Telegram popup state was not found or has expired");
  }

  await assertTelegramLinkSession(authState, cookieStore);

  return verifyTelegramIdTokenForState(idToken, {
    authState,
    nonce,
    cookieStore,
  });
}

export async function verifyTelegramWidgetCallbackPayload(payload: TelegramLoginWidgetPayload) {
  const cookieStore = await cookies();
  const nonce = cookieStore.get(telegramOidcCookieNames.nonce)?.value;

  authDebugLog("telegram_widget_callback_consume_started", {
    hasHash: Boolean(payload.hash),
    hasNonceCookie: Boolean(nonce),
  });

  if (!nonce) {
    logTechnicalWarning("telegram_widget_nonce_cookie_invalid", {
      hasNonce: false,
    });

    throw new Error("Telegram widget nonce is invalid");
  }

  const authState = await prisma.telegramAuthState.findFirst({
    where: {
      nonceHash: sha256(nonce),
      consumedAt: null,
      expiresAt: { gt: new Date() },
    },
  });

  if (!authState) {
    logTechnicalWarning("telegram_widget_state_not_found", {
      hasNonce: true,
    });

    throw new Error("Telegram widget state was not found or has expired");
  }

  await assertTelegramLinkSession(authState, cookieStore);

  const verifiedPayload = verifyTelegramLoginWidgetPayload(payload);
  const fullName = [
    verifiedPayload.first_name,
    verifiedPayload.last_name,
  ].filter(Boolean).join(" ") || null;

  await assertTelegramLinkSession(authState, cookieStore);

  await claimTelegramLoginWidgetPayload(verifiedPayload);
  await claimTelegramAuthState(authState);

  const identity = {
    telegramId: verifiedPayload.id.toString(),
    telegramUsername: verifiedPayload.username ?? null,
    fullName,
    photoUrl: verifiedPayload.photo_url ?? null,
    remnashopAuthResult: await authenticateRemnashopWithTelegramPayload(verifiedPayload),
    source: "widget",
  } as const;
  return { authState, identity };
}

async function verifyTelegramIdTokenForState(
  idToken: string,
  {
    authState,
    nonce,
    cookieStore,
  }: {
    authState: {
      id: string;
      userId: string | null;
      redirectTo: string | null;
      expiresAt: Date;
    };
    nonce: string;
    cookieStore: TelegramCookieStore;
  },
) {
  const payload = await verifyTelegramIdToken(idToken, nonce).catch((error) => {
    logTechnicalError("telegram_id_token_verification_failed", error, {
      authStateId: authState.id,
      hasUserId: Boolean(authState.userId),
    });

    throw error;
  });

  const telegramId = getTelegramId(payload);
  const telegramUsername =
    typeof payload.preferred_username === "string"
      ? payload.preferred_username
      : null;
  const fullName = getFullName(payload);
  const photoUrl = typeof payload.picture === "string" ? payload.picture : null;
  await assertTelegramLinkSession(authState, cookieStore);
  await claimTelegramAuthState(authState);
  const remnashopAuthResult = await authenticateRemnashopWithTelegram(
    payload,
    telegramId,
    telegramUsername,
  );

  const identity = {
    telegramId,
    telegramUsername,
    fullName,
    photoUrl,
    remnashopAuthResult,
    source: "oidc",
  } as const;
  return { authState, identity };
}

async function claimTelegramAuthState(authState: { id: string }) {
  if (!await claimTelegramAuthStateRecord(authState.id)) {
    logTechnicalWarning("telegram_oidc_state_already_consumed", {
      authStateId: authState.id,
    });
    throw new TelegramAuthStateAlreadyConsumedError();
  }
}

async function assertTelegramLinkSession(
  authState: { id: string; userId: string | null },
  cookieStore: TelegramCookieStore,
) {
  if (!authState.userId) {
    return;
  }

  const session = await getCurrentSession();

  if (session?.userId === authState.userId) {
    return;
  }

  authDebugLog("telegram_link_session_mismatch", {
    authStateId: authState.id,
    targetUserId: authState.userId,
    hasCurrentSession: Boolean(session),
    currentSessionId: session?.id,
  });

  try {
    await claimTelegramAuthState(authState);
  } finally {
    clearTemporaryTelegramAuthCookies(cookieStore);
  }

  throw new ServiceError(
    "UNAUTHORIZED",
    401,
    "Telegram account linking session is no longer active",
  );
}
