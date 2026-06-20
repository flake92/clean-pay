import type { JWTPayload } from "jose";
import { createRemoteJWKSet, jwtVerify } from "jose";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";

import { randomToken, sha256 } from "@/lib/crypto";
import { getEnv } from "@/lib/env";
import { prisma } from "@/lib/prisma";
import { assertRateLimit } from "@/lib/rate-limit";

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

  return response;
}

async function exchangeCodeForIdToken(code: string, codeVerifier: string) {
  const env = getEnv();
  const body = new URLSearchParams({
    grant_type: "authorization_code",
    code,
    redirect_uri: env.telegramOidc.redirectUri,
    client_id: env.telegramOidc.clientId,
    client_secret: env.telegramOidc.clientSecret,
    code_verifier: codeVerifier,
  });

  const response = await fetch(env.telegramOidc.tokenEndpoint, {
    method: "POST",
    headers: {
      "content-type": "application/x-www-form-urlencoded",
    },
    body,
    cache: "no-store",
  });

  if (!response.ok) {
    throw new Error("Telegram token exchange failed");
  }

  const tokenSet = (await response.json()) as { id_token?: string };

  if (!tokenSet.id_token) {
    throw new Error("Telegram token response does not contain id_token");
  }

  return tokenSet.id_token;
}

async function verifyTelegramIdToken(idToken: string, nonce: string) {
  const env = getEnv();
  const jwks = createRemoteJWKSet(new URL(env.telegramOidc.jwksUri));
  const result = await jwtVerify(idToken, jwks, {
    issuer: env.telegramOidc.issuer,
    audience: env.telegramOidc.clientId,
  });

  if (result.payload.nonce !== nonce) {
    throw new Error("Telegram id_token nonce mismatch");
  }

  return result.payload;
}

function getTelegramId(payload: JWTPayload) {
  const rawTelegramId = payload.telegram_id ?? payload.sub;

  if (
    typeof rawTelegramId !== "string" &&
    typeof rawTelegramId !== "number"
  ) {
    throw new Error("Telegram id_token does not contain telegram_id");
  }

  const telegramId = BigInt(rawTelegramId);

  if (telegramId <= BigInt(0)) {
    throw new Error("Telegram id_token contains invalid telegram_id");
  }

  return telegramId;
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

export async function consumeTelegramCallback(code: string, state: string) {
  const cookieStore = await cookies();
  const cookieState = cookieStore.get(telegramOidcCookieNames.state)?.value;
  const nonce = cookieStore.get(telegramOidcCookieNames.nonce)?.value;
  const codeVerifier = cookieStore.get(
    telegramOidcCookieNames.codeVerifier,
  )?.value;

  if (!cookieState || cookieState !== state || !nonce || !codeVerifier) {
    throw new Error("Telegram OIDC state is invalid");
  }

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
    throw new Error("Telegram OIDC state was not found or has expired");
  }

  const idToken = await exchangeCodeForIdToken(code, codeVerifier);
  const payload = await verifyTelegramIdToken(idToken, nonce);
  const telegramId = getTelegramId(payload);
  const telegramUsername =
    typeof payload.preferred_username === "string"
      ? payload.preferred_username
      : null;
  const fullName = getFullName(payload);
  const photoUrl = typeof payload.picture === "string" ? payload.picture : null;

  await assertRateLimit({
    action: authState.userId ? "telegram_link_confirm" : "telegram_login_confirm",
    tgId: telegramId,
    limit: 10,
    windowSeconds: 15 * 60,
  });

  const existingTelegramUser = await prisma.webUser.findUnique({
    where: { telegramId },
  });

  if (
    authState.userId &&
    existingTelegramUser &&
    existingTelegramUser.id !== authState.userId
  ) {
    throw new Error("Telegram account is already linked to another user");
  }

  const user = authState.userId
    ? await prisma.webUser.update({
        where: { id: authState.userId },
        data: {
          telegramId,
          telegramUsername,
          fullName,
          photoUrl,
          displayName: fullName ?? telegramUsername,
          lastLoginAt: new Date(),
        },
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

  await prisma.auditLog.create({
    data: {
      userId: user.id,
      action: "telegram_login",
      metadata: {
        telegramId: telegramId.toString(),
      },
    },
  });

  cookieStore.delete(telegramOidcCookieNames.state);
  cookieStore.delete(telegramOidcCookieNames.nonce);
  cookieStore.delete(telegramOidcCookieNames.codeVerifier);

  return {
    user,
    redirectTo: authState.redirectTo,
  };
}
