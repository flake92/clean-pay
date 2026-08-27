// Telegram OIDC state-machine orchestration; public imports use the stable façade.
import { cookies } from "next/headers";
import { NextResponse } from "next/server";

import { logTechnicalError, logTechnicalWarning } from "@/backend/observability/audit";
import { authDebugLog } from "@/backend/observability/auth-debug-log";
import { randomToken, sha256 } from "@/backend/security/crypto";
import { getEnv } from "@/backend/config/env";
import { ServiceError } from "@/backend/errors/service-error";
import { getCurrentSession } from "@/backend/integrations/sessions/web-session-service";
import { clearTelegramCallbackReceipt } from "@/backend/integrations/telegram/callback-receipt";
import type { VerifiedTelegramCallback } from "@/application/auth/ports/telegram-callback";
import {
  getTelegramFullName,
  getTelegramId,
  type TelegramLoginWidgetPayload,
  verifyTelegramLoginWidgetPayload,
} from "@/backend/integrations/telegram/oidc-codec";
import {
  claimTelegramAuthState,
  claimTelegramLoginWidgetPayload,
  createTelegramAuthState,
  findTelegramAuthStateByNonce,
  findTelegramAuthStateByProof,
  TelegramAuthStateAlreadyConsumedError,
} from "@/backend/integrations/telegram/oidc-repository";
import {
  authenticateRemnashopWithTelegramIdentity,
  authenticateRemnashopWithTelegramPayload,
  exchangeTelegramCodeForIdToken,
  verifyTelegramIdToken,
} from "@/backend/integrations/telegram/oidc-transport";
import {
  checkpointDurableTelegramIdentity,
  checkpointDurableTelegramProvider,
  claimDurableTelegramProviderReady,
  DURABLE_TELEGRAM_CALLBACK_MAX_IN_FLIGHT_MS,
  DURABLE_TELEGRAM_CALLBACK_RESULT_TTL_MS,
  DurableTelegramCallbackClaimConflictError,
  failDurableTelegramCallback,
  markDurableTelegramProviderDispatching,
  markDurableTelegramRemnashopDispatching,
  type DurableTelegramCallbackOwnership,
  type TelegramCallbackCookieProof,
} from "@/backend/integrations/telegram/durable-callback";

const telegramAuthTtlSeconds = 10 * 60;
const telegramCallbackProofClockSkewSeconds = 30;
// READY may be claimed at the end of its 10-minute acceptance window. Durable
// work then has one bounded 10-minute in-flight window, followed by a full
// 10-minute lost-response replay window. The proof cookie covers all three
// windows plus skew; durable transitions enforce the matching absolute work
// deadline from TelegramAuthState.expiresAt.
const telegramCallbackProofTtlSeconds = telegramAuthTtlSeconds
  + DURABLE_TELEGRAM_CALLBACK_MAX_IN_FLIGHT_MS / 1_000
  + DURABLE_TELEGRAM_CALLBACK_RESULT_TTL_MS / 1_000
  + telegramCallbackProofClockSkewSeconds;
export { TelegramAuthStateAlreadyConsumedError } from "@/backend/integrations/telegram/oidc-repository";
export { resetTelegramOidcJwksForTests } from "@/backend/integrations/telegram/oidc-transport";

const telegramOidcCookieNames = {
  state: "clean_pay_tg_state",
  nonce: "clean_pay_tg_nonce",
  codeVerifier: "clean_pay_tg_code_verifier",
} as const;

type TelegramCookieStore = Awaited<ReturnType<typeof cookies>>;

async function telegramCallbackCookieContext(state: string) {
  const cookieStore = await cookies();
  const cookieState = cookieStore.get(telegramOidcCookieNames.state)?.value;
  const nonce = cookieStore.get(telegramOidcCookieNames.nonce)?.value;
  const codeVerifier = cookieStore.get(
    telegramOidcCookieNames.codeVerifier,
  )?.value;
  if (!cookieState || cookieState !== state || !nonce || !codeVerifier) {
    logTechnicalWarning("telegram_oidc_state_cookie_invalid", {
      storedStatePresent: Boolean(cookieState),
      stateMatches: Boolean(cookieState && cookieState === state),
      hasNonce: Boolean(nonce),
      verifierPresent: Boolean(codeVerifier),
    });
    throw new Error("Telegram OIDC state is invalid");
  }
  return {
    cookieStore,
    nonce,
    codeVerifier,
    proof: {
      stateHash: sha256(state),
      nonceHash: sha256(nonce),
      codeVerifierHash: sha256(codeVerifier),
    } satisfies TelegramCallbackCookieProof,
  };
}

export async function readTelegramCallbackCookieProof(state: string) {
  return (await telegramCallbackCookieContext(state)).proof;
}

function clearTemporaryTelegramAuthCookies(cookieStore: TelegramCookieStore) {
  cookieStore.delete(telegramOidcCookieNames.state);
  cookieStore.delete(telegramOidcCookieNames.nonce);
  cookieStore.delete(telegramOidcCookieNames.codeVerifier);
}

export async function clearTelegramAuthCookies() {
  clearTemporaryTelegramAuthCookies(await cookies());
}

export function clearTelegramAuthCookiesOnResponse(response: NextResponse) {
  for (const name of Object.values(telegramOidcCookieNames)) {
    response.cookies.set(name, "", {
      ...temporaryCookieOptions(),
      maxAge: 0,
      expires: new Date(0),
    });
  }
}

function addSeconds(date: Date, seconds: number) {
  return new Date(date.getTime() + seconds * 1000);
}

function temporaryCookieOptions(now = new Date()) {
  const env = getEnv();

  return {
    httpOnly: true,
    secure: env.cookieSecure,
    // Strict cookies are omitted when Telegram redirects back from its OIDC
    // origin, so they cannot carry the state/nonce proof on the callback.
    sameSite: env.cookieSameSite === "strict" ? "lax" : env.cookieSameSite,
    path: "/",
    maxAge: telegramCallbackProofTtlSeconds,
    expires: addSeconds(now, telegramCallbackProofTtlSeconds),
  } as const;
}

export async function createTelegramAuthorizationResponse(
  redirectTo?: string,
  userId?: string,
) {
  const env = getEnv();
  const now = new Date();
  authDebugLog("telegram_oidc_start_started", {
    hasRedirectTo: Boolean(redirectTo),
    linkUserId: userId,
  });
  const state = randomToken();
  const nonce = randomToken();
  const codeVerifier = randomToken(64);
  const codeChallenge = sha256(codeVerifier);

  await createTelegramAuthState({
    stateHash: sha256(state),
    nonceHash: sha256(nonce),
    codeVerifierHash: sha256(codeVerifier),
    redirectTo,
    userId,
    expiresAt: addSeconds(now, telegramAuthTtlSeconds),
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
  const cookieOptions = temporaryCookieOptions(now);

  clearTelegramCallbackReceipt(response);
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
  const now = new Date();
  const state = randomToken();
  const nonce = randomToken();
  const codeVerifier = randomToken(64);

  await createTelegramAuthState({
    stateHash: sha256(state),
    nonceHash: sha256(nonce),
    codeVerifierHash: sha256(codeVerifier),
    redirectTo,
    userId,
    expiresAt: addSeconds(now, telegramAuthTtlSeconds),
  });

  const response = NextResponse.json({
    clientId: env.telegramOidc.clientId,
    nonce,
    redirectUri: env.telegramOidc.redirectUri,
  });
  const cookieOptions = temporaryCookieOptions(now);

  clearTelegramCallbackReceipt(response);
  response.cookies.set(telegramOidcCookieNames.state, state, cookieOptions);
  response.cookies.set(telegramOidcCookieNames.nonce, nonce, cookieOptions);
  response.cookies.set(
    telegramOidcCookieNames.codeVerifier,
    codeVerifier,
    cookieOptions,
  );

  return response;
}

export async function verifyTelegramCallback(code: string, state: string) {
  const { cookieStore, nonce, codeVerifier, proof } =
    await telegramCallbackCookieContext(state);

  authDebugLog("telegram_oidc_callback_consume_started", {
    hasCode: Boolean(code),
    hasStateParam: Boolean(state),
    hasStateCookie: true,
    hasNonceCookie: true,
    hasCodeVerifierCookie: true,
  });
  authDebugLog("telegram_oidc_callback_cookies_valid", {
    stateMatches: true,
    hasNonceCookie: true,
    hasCodeVerifierCookie: true,
  });

  const authState = await findTelegramAuthStateByProof({
    stateHash: proof.stateHash,
    nonceHash: proof.nonceHash,
    codeVerifierHash: proof.codeVerifierHash,
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
  let ownership: DurableTelegramCallbackOwnership;
  try {
    ownership = await claimDurableTelegramProviderReady({
      authState,
      proof,
      codeHash: sha256(code),
    });
  } catch (error) {
    if (error instanceof DurableTelegramCallbackClaimConflictError) {
      throw new TelegramAuthStateAlreadyConsumedError();
    }
    throw error;
  }

  const verified = await dispatchClaimedTelegramOidcCode({
    code,
    nonce,
    codeVerifier,
    cookieStore,
    authState: {
      id: authState.id,
      targetUserId: authState.userId,
      redirectTo: authState.redirectTo,
    },
    ownership,
  });
  return {
    authState,
    identity: {
      telegramId: verified.identity.telegramId,
      telegramUsername: verified.identity.telegramUsername,
      fullName: verified.identity.fullName,
      photoUrl: verified.identity.photoUrl,
      remnashopAuthResult:
        verified.identity.providerSession?.context ?? null,
    },
    durable: ownership,
  };
}

export async function resumeTelegramOidcCodeExchange(
  code: string,
  state: string,
  authState: {
    id: string;
    targetUserId: string | null;
    redirectTo: string | null;
  },
  ownership: DurableTelegramCallbackOwnership,
) {
  const { cookieStore, nonce, codeVerifier } =
    await telegramCallbackCookieContext(state);
  await assertTelegramLinkSession(
    { id: authState.id, userId: authState.targetUserId },
    cookieStore,
  );
  return dispatchClaimedTelegramOidcCode({
    code,
    nonce,
    codeVerifier,
    cookieStore,
    authState,
    ownership,
  });
}

async function dispatchClaimedTelegramOidcCode({
  code,
  nonce,
  codeVerifier,
  cookieStore,
  authState,
  ownership,
}: {
  code: string;
  nonce: string;
  codeVerifier: string;
  cookieStore: TelegramCookieStore;
  authState: {
    id: string;
    targetUserId: string | null;
    redirectTo: string | null;
  };
  ownership: DurableTelegramCallbackOwnership;
}) {
  // This committed marker is the no-redispatch boundary for the one-time
  // authorization code. A worker may resume PROVIDER_READY, but once this CAS
  // succeeds no later worker calls the token endpoint if the response is lost.
  await markDurableTelegramProviderDispatching(
    ownership,
    authState,
  );
  let idToken: string;
  try {
    idToken = await exchangeTelegramCodeForIdToken(code, codeVerifier);
  } catch (error) {
    await failDurableTelegramCallback(
      ownership,
      "PROVIDER_DISPATCHING",
      "OIDC_CODE_EXCHANGE_FAILED",
      "/login?auth=telegram_recovery_required",
    ).catch((failureError) => {
      logTechnicalError(
        "telegram_oidc_dispatch_failure_checkpoint_failed",
        failureError,
        { authStateId: authState.id },
      );
    });
    throw error;
  }

  try {
    return await verifyTelegramIdTokenForState(idToken, {
      authState: {
        id: authState.id,
        userId: authState.targetUserId,
        redirectTo: authState.redirectTo,
      },
      nonce,
      cookieStore,
      ownership,
    }) as VerifiedTelegramCallback;
  } catch (error) {
    // This CAS succeeds only while the ambiguous dispatch phase still owns
    // the row. If identity/provider checkpointing already advanced, its own
    // retry policy remains authoritative and this attempt is a harmless miss.
    await failDurableTelegramCallback(
      ownership,
      "PROVIDER_DISPATCHING",
      "OIDC_IDENTITY_CHECKPOINT_FAILED",
      "/login?auth=telegram_recovery_required",
    ).catch(() => undefined);
    throw error;
  }
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

  const authState = await findTelegramAuthStateByNonce(sha256(nonce));

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

  const authState = await findTelegramAuthStateByNonce(sha256(nonce));

  if (!authState) {
    logTechnicalWarning("telegram_widget_state_not_found", {
      hasNonce: true,
    });

    throw new Error("Telegram widget state was not found or has expired");
  }

  await assertTelegramLinkSession(authState, cookieStore);

  const verifiedPayload = verifyTelegramLoginWidgetPayload(payload, {
    botToken: getEnv().telegramBotToken,
    nowEpochSeconds: Math.floor(Date.now() / 1000),
  });
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
    ownership,
  }: {
    authState: {
      id: string;
      userId: string | null;
      redirectTo: string | null;
      expiresAt?: Date;
    };
    nonce: string;
    cookieStore: TelegramCookieStore;
    ownership?: DurableTelegramCallbackOwnership;
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
  const fullName = getTelegramFullName(payload);
  const photoUrl = typeof payload.picture === "string" ? payload.picture : null;
  await assertTelegramLinkSession(authState, cookieStore);
  if (ownership) {
    const verified: VerifiedTelegramCallback = {
      authState: {
        id: authState.id,
        targetUserId: authState.userId,
        redirectTo: authState.redirectTo,
      },
      identity: {
        telegramId,
        telegramUsername,
        fullName,
        photoUrl,
        providerSession: null,
      },
    };
    await checkpointDurableTelegramIdentity(ownership, verified);
    const authenticated = await resumeTelegramProviderAuthentication(
      verified,
      ownership,
    );
    return authenticated;
  }

  await claimTelegramAuthState(authState);
  const remnashopAuthResult = await authenticateRemnashopWithTelegramIdentity({
    telegramId,
    telegramUsername,
    fullName,
    photoUrl,
  });

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

export async function resumeTelegramProviderAuthentication(
  verified: VerifiedTelegramCallback,
  ownership: DurableTelegramCallbackOwnership,
) {
  await markDurableTelegramRemnashopDispatching(ownership, verified);
  let remnashopAuthResult;
  try {
    remnashopAuthResult = await authenticateRemnashopWithTelegramIdentity(
      verified.identity,
      { failClosed: true },
    );
  } catch (error) {
    await failDurableTelegramCallback(
      ownership,
      "REMNASHOP_DISPATCHING",
      "REMNASHOP_AUTH_AMBIGUOUS",
      "/login?auth=telegram_recovery_required",
    ).catch(() => undefined);
    throw new ServiceError(
      "UPSTREAM_UNAVAILABLE",
      503,
      "Telegram provider authentication is unavailable",
      { cause: error },
    );
  }
  if (!remnashopAuthResult) {
    await failDurableTelegramCallback(
      ownership,
      "REMNASHOP_DISPATCHING",
      "REMNASHOP_AUTH_UNAVAILABLE",
      "/login?auth=telegram_recovery_required",
    );
    throw new ServiceError(
      "UPSTREAM_UNAVAILABLE",
      503,
      "Telegram provider authentication is unavailable",
    );
  }
  const authenticated: VerifiedTelegramCallback = {
    ...verified,
    identity: {
      ...verified.identity,
      providerSession: { context: remnashopAuthResult },
    },
    durable: ownership,
  };
  await checkpointDurableTelegramProvider(ownership, {
    ...authenticated,
    durable: undefined,
  });
  return authenticated;
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
