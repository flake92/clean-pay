import { createHash, createHmac } from "node:crypto";
import type { JWTPayload } from "jose";
import { createRemoteJWKSet, jwtVerify } from "jose";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";

import { auditLog, logTechnicalError, logTechnicalWarning } from "@/backend/observability/audit";
import { authDebugLog } from "@/backend/observability/auth-debug-log";
import { randomToken, sha256 } from "@/backend/security/crypto";
import { getEnv } from "@/backend/config/env";
import { logger } from "@/backend/observability/logger";
import { prisma } from "@/backend/database/prisma";
import { assertRateLimit } from "@/backend/limits/rate-limit";
import { remnashopAuth } from "@/backend/integrations/remnashop/client";
import type { TelegramAuthRequest } from "@/shared/remnashop/types";

const telegramAuthTtlSeconds = 10 * 60;

const telegramOidcCookieNames = {
  state: "clean_pay_tg_state",
  nonce: "clean_pay_tg_nonce",
  codeVerifier: "clean_pay_tg_code_verifier",
} as const;

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
    client_secret: env.telegramOidc.clientSecret,
    code_verifier: codeVerifier,
  });
  const startedAt = Date.now();

  logger.info("telegram_token_request_sent", {
    method: "POST",
    url: env.telegramOidc.tokenEndpoint,
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: Object.fromEntries(body.entries()),
  }, {
    category: "upstream",
    source: "telegram.oidc",
    message: "HTTP Request: POST Telegram OIDC token",
  });

  const response = await fetch(env.telegramOidc.tokenEndpoint, {
    method: "POST",
    headers: {
      "content-type": "application/x-www-form-urlencoded",
    },
    body,
    cache: "no-store",
  });
  const responseText = await response.clone().text().catch(() => "");

  logger.info("telegram_token_response_received", {
    method: "POST",
    url: env.telegramOidc.tokenEndpoint,
    status: response.status,
    ok: response.ok,
    durationMs: Date.now() - startedAt,
    body: parseTelegramTokenLogBody(responseText),
  }, {
    category: "upstream",
    source: "telegram.oidc",
    message: `HTTP Response: POST Telegram OIDC token -> ${response.status}`,
  });

  if (!response.ok) {
    const errorBody = responseText || null;

    logTechnicalWarning("telegram_token_exchange_failed", {
      status: response.status,
      statusText: response.statusText,
      body: errorBody?.slice(0, 500),
    });

    throw new Error("Telegram token exchange failed");
  }

  const tokenSet = (await response.json()) as { id_token?: string };

  if (!tokenSet.id_token) {
    throw new Error("Telegram token response does not contain id_token");
  }

  authDebugLog("telegram_oidc_token_exchange_success", { hasIdToken: true });

  return tokenSet.id_token;
}

function parseTelegramTokenLogBody(text: string) {
  if (!text) {
    return null;
  }

  try {
    return JSON.parse(text);
  } catch {
    return text.slice(0, 500);
  }
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

export async function consumeTelegramCallback(code: string, state: string) {
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

  const idToken = await exchangeCodeForIdToken(code, codeVerifier);
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

  authDebugLog("telegram_oidc_identity_resolved", {
    authStateId: authState.id,
    telegramId,
    hasUsername: Boolean(telegramUsername),
    hasFullName: Boolean(fullName),
    hasPhotoUrl: Boolean(photoUrl),
    linkUserId: authState.userId,
  });

  await assertRateLimit({
    action: authState.userId ? "telegram_link_confirm" : "telegram_login_confirm",
    tgId: telegramId,
    limit: 10,
    windowSeconds: 15 * 60,
  });
  authDebugLog("telegram_oidc_rate_limit_passed", {
    action: authState.userId ? "telegram_link_confirm" : "telegram_login_confirm",
    telegramId,
  });

  const existingTelegramUser = await prisma.webUser.findUnique({
    where: { telegramId },
  });

  const targetUserId = authState.userId;
  authDebugLog("telegram_oidc_user_resolution_started", {
    targetUserId,
    existingTelegramUserId: existingTelegramUser?.id,
    mergeRequired: Boolean(targetUserId && existingTelegramUser && existingTelegramUser.id !== targetUserId),
  });
  const user = targetUserId
    ? await prisma.$transaction(async (tx) => {
        const targetUser = await tx.webUser.findUniqueOrThrow({
          where: { id: targetUserId },
        });
        const sourceUser =
          existingTelegramUser && existingTelegramUser.id !== targetUserId
            ? existingTelegramUser
            : null;

        if (sourceUser) {
          authDebugLog("telegram_oidc_link_merge_started", {
            targetUserId,
            sourceUserId: sourceUser.id,
          });
          await tx.webUser.update({
            where: { id: sourceUser.id },
            data: {
              remnashopUserId: null,
              email: null,
              telegramId: null,
            },
          });
          await tx.webSession.updateMany({
            where: { userId: sourceUser.id },
            data: { userId: targetUserId },
          });
          await tx.auditLog.updateMany({
            where: { userId: sourceUser.id },
            data: { userId: targetUserId },
          });
          await tx.paymentRecord.updateMany({
            where: { userId: sourceUser.id },
            data: { userId: targetUserId },
          });
          await tx.emailVerificationCode.updateMany({
            where: { userId: sourceUser.id },
            data: { userId: targetUserId },
          });
          await tx.telegramAuthState.updateMany({
            where: { userId: sourceUser.id },
            data: { userId: targetUserId },
          });
          await tx.webUser.delete({
            where: { id: sourceUser.id },
          });
          authDebugLog("telegram_oidc_link_merge_completed", {
            targetUserId,
            sourceUserId: sourceUser.id,
          });
        }

        return tx.webUser.update({
          where: { id: targetUserId },
          data: {
            remnashopUserId: targetUser.remnashopUserId ?? sourceUser?.remnashopUserId,
            email: targetUser.email ?? sourceUser?.email,
            emailVerified: targetUser.emailVerified || Boolean(sourceUser?.emailVerified),
            telegramId,
            telegramUsername,
            fullName,
        photoUrl,
        displayName: fullName ?? telegramUsername,
        authPending: false,
        lastLoginAt: new Date(),
      },
        });
      })
    : await prisma.webUser.upsert({
        where: { telegramId },
        create: {
          telegramId,
          telegramUsername,
          fullName,
          photoUrl,
          displayName: fullName ?? telegramUsername,
          lastLoginAt: new Date(),
        },
        update: {
          telegramUsername,
          fullName,
          photoUrl,
          displayName: fullName ?? telegramUsername,
          lastLoginAt: new Date(),
        },
      });

  await prisma.telegramAuthState.update({
    where: { id: authState.id },
    data: {
      userId: user.id,
      consumedAt: new Date(),
    },
  });
  authDebugLog("telegram_oidc_state_consumed", {
    authStateId: authState.id,
    userId: user.id,
  });

  await auditLog({
    action: authState.userId ? "telegram_link_success" : "telegram_login",
    userId: user.id,
    metadata: { telegramId: telegramId.toString() },
  });

  const remnashopAuthResult = await authenticateRemnashopWithTelegram(
    payload,
    telegramId,
    telegramUsername,
  );

  cookieStore.delete(telegramOidcCookieNames.state);
  cookieStore.delete(telegramOidcCookieNames.nonce);
  cookieStore.delete(telegramOidcCookieNames.codeVerifier);

  authDebugLog("telegram_oidc_callback_success", {
    authStateId: authState.id,
    userId: user.id,
    telegramId,
    redirectTo: authState.redirectTo,
    linked: Boolean(authState.userId),
  });

  return {
    user,
    redirectTo: authState.redirectTo,
    remnashopAuth: remnashopAuthResult,
  };
}
