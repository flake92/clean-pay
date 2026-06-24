import { auditLog } from "@/lib/audit";
import { authDebugLog } from "@/lib/auth-debug-log";
import { prisma } from "@/lib/prisma";
import { assertCooldown, assertRateLimit } from "@/lib/rate-limit";
import {
  getAuthorizedRemnashopTokens,
  getJwtExpiresAt,
  getRemnashopMe,
  protectRemnashopToken,
  remnashopAuth,
  remnashopChangePassword,
  remnashopRequest,
} from "@/lib/remnashop/client";
import { BffError } from "@/lib/remnashop/errors";
import { createSessionFromRemnashopAuth, linkCurrentUserToRemnashopAuth } from "@/lib/remnashop/session";
import { refreshCurrentAccessCookie, getCurrentSession } from "@/lib/session";
import { verifyTurnstileToken } from "@/lib/turnstile";
import type {
  ChangeEmailRequest,
  ChangeEmailResponse,
  ChangePasswordRequest,
  ConfirmEmailVerificationRequest,
  ConfirmEmailVerificationResponse,
  LoginRequest,
  RegisterRequest,
  RequestEmailVerificationRequest,
  RequestEmailVerificationResponse,
} from "@/lib/remnashop/types";
import { localUserProfile, remnashopUserProfile } from "@/server/auth/profile-presenter";

type TurnstileContext = {
  token?: string | null;
  remoteIp?: string | null;
};

type AuthPayload<T> = T & {
  turnstileToken?: string | null;
  "cf-turnstile-response"?: string | null;
};

function stripTurnstile<T extends Record<string, unknown>>(body: AuthPayload<T>) {
  const { turnstileToken, "cf-turnstile-response": cfTurnstileResponse, ...cleanBody } = body;

  return {
    body: cleanBody as T,
    turnstileToken: turnstileToken ?? cfTurnstileResponse ?? null,
  };
}

function addDays(date: Date, days: number) {
  return new Date(date.getTime() + days * 24 * 60 * 60 * 1000);
}

function isEmailAlreadyExistsConflict(error: unknown) {
  return (
    error instanceof BffError &&
    error.code === "CONFLICT" &&
    String(error.debug?.message ?? error.message).toLowerCase().includes("email already exists")
  );
}

async function createOrResumeEmailRegistration(body: RegisterRequest) {
  try {
    const auth = await remnashopAuth("/auth/register", body);
    authDebugLog("auth_register_remnashop_success", {
      flow: "created",
      accessExpiresAt: auth.data.expires_at,
      refreshExpiresAt: auth.data.refresh_expires_at,
    });

    return { auth, flow: "created" as const };
  } catch (error) {
    if (!isEmailAlreadyExistsConflict(error)) {
      throw error;
    }

    authDebugLog("auth_register_existing_email_detected", {
      hasEmail: Boolean(body.email),
      action: "login_existing_email",
    });
    const auth = await remnashopAuth("/auth/login", {
      email: body.email,
      password: body.password,
    });
    authDebugLog("auth_register_remnashop_success", {
      flow: "existing_email_login",
      accessExpiresAt: auth.data.expires_at,
      refreshExpiresAt: auth.data.refresh_expires_at,
    });

    return { auth, flow: "existing_email_login" as const };
  }
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isTransientEmailSendError(error: unknown) {
  return (
    error instanceof BffError &&
    error.code === "UPSTREAM_UNAVAILABLE" &&
    String(error.debug?.message ?? error.message).toLowerCase().includes("failed to send verification email")
  );
}

async function requestRemnashopEmailVerification({
  accessToken,
  body,
  source,
}: {
  accessToken: string;
  body: RequestEmailVerificationRequest;
  source: string;
}) {
  const maxAttempts = 3;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      return await remnashopRequest<RequestEmailVerificationResponse>(
        "/auth/email/request-verification",
        {
          method: "POST",
          accessToken,
          body,
        },
      );
    } catch (error) {
      if (!isTransientEmailSendError(error) || attempt === maxAttempts) {
        throw error;
      }

      authDebugLog("email_verification_request_retry_scheduled", {
        source,
        attempt,
        nextAttempt: attempt + 1,
        maxAttempts,
      });
      await sleep(300 * attempt);
    }
  }

  throw new BffError("UPSTREAM_UNAVAILABLE", 502, "Failed to send verification email");
}

export async function loginWithEmail(rawBody: AuthPayload<LoginRequest>, turnstile: TurnstileContext) {
  const { body, turnstileToken } = stripTurnstile(rawBody);

  authDebugLog("auth_login_started", {
    hasEmail: Boolean(body.email),
    hasTurnstileToken: Boolean(turnstileToken ?? turnstile.token),
    hasRemoteIp: Boolean(turnstile.remoteIp),
  });
  await verifyTurnstileToken(turnstileToken ?? turnstile.token, turnstile.remoteIp);
  authDebugLog("auth_login_turnstile_passed", { hasRemoteIp: Boolean(turnstile.remoteIp) });
  await assertRateLimit({
    action: "auth_login",
    email: body.email,
    limit: 5,
    windowSeconds: 15 * 60,
  });
  authDebugLog("auth_login_rate_limit_passed", { action: "auth_login" });

  const auth = await remnashopAuth("/auth/login", body);
  authDebugLog("auth_login_remnashop_success", {
    accessExpiresAt: auth.data.expires_at,
    refreshExpiresAt: auth.data.refresh_expires_at,
  });
  const { user, profile } = await createSessionFromRemnashopAuth({
    accessToken: auth.cookies.accessToken,
    refreshToken: auth.cookies.refreshToken,
    auth: auth.data,
  });

  await auditLog({
    action: "auth_login_success",
    userId: user.id,
    metadata: { email: user.email, telegramId: user.telegramId },
  });

  authDebugLog("auth_login_success", {
    userId: user.id,
    hasEmail: Boolean(user.email),
    emailVerified: user.emailVerified,
    hasTelegramId: Boolean(user.telegramId),
    profileAuthType: profile.auth_type,
  });

  return {
    user: profile,
    expiresAt: auth.data.expires_at,
    refreshExpiresAt: auth.data.refresh_expires_at,
  };
}

export async function registerWithEmail(rawBody: AuthPayload<RegisterRequest>, turnstile: TurnstileContext) {
  const { body, turnstileToken } = stripTurnstile(rawBody);

  authDebugLog("auth_register_started", {
    hasEmail: Boolean(body.email),
    hasName: Boolean(body.name),
    hasReferralCode: Boolean(body.referral_code),
    hasTurnstileToken: Boolean(turnstileToken ?? turnstile.token),
    hasRemoteIp: Boolean(turnstile.remoteIp),
  });
  await verifyTurnstileToken(turnstileToken ?? turnstile.token, turnstile.remoteIp);
  authDebugLog("auth_register_turnstile_passed", { hasRemoteIp: Boolean(turnstile.remoteIp) });
  await assertRateLimit({
    action: "auth_register",
    email: body.email,
    limit: 5,
    windowSeconds: 15 * 60,
  });
  authDebugLog("auth_register_rate_limit_passed", { action: "auth_register" });

  const { auth, flow } = await createOrResumeEmailRegistration(body);
  const verification = await requestRemnashopEmailVerification({
    accessToken: auth.cookies.accessToken,
    body: { email: body.email },
    source: "register",
  });
  const { user, profile } = await createSessionFromRemnashopAuth({
    accessToken: auth.cookies.accessToken,
    refreshToken: auth.cookies.refreshToken,
    auth: auth.data,
  });
  authDebugLog("auth_register_verification_requested", {
    flow,
    userId: user.id,
    targetEmail: verification.target_email,
    expiresAt: verification.expires_at,
  });

  await auditLog({
    action: "auth_register_success",
    userId: user.id,
    metadata: { email: user.email, telegramId: user.telegramId, verificationTargetEmail: verification.target_email, flow },
  });

  authDebugLog("auth_register_success", {
    flow,
    userId: user.id,
    hasEmail: Boolean(user.email),
    emailVerified: user.emailVerified,
    hasTelegramId: Boolean(user.telegramId),
    profileAuthType: profile.auth_type,
  });

  return {
    user: profile,
    expiresAt: auth.data.expires_at,
    refreshExpiresAt: auth.data.refresh_expires_at,
    emailVerification: verification,
  };
}

export async function getCurrentAuthProfile() {
  authDebugLog("auth_me_started", {});
  const session = await getCurrentSession();

  if (!session) {
    authDebugLog("auth_me_unauthorized", { reason: "missing_session" });
    throw new BffError("UNAUTHORIZED", 401, "Session is required");
  }

  if (!session.remnashopAccessTokenEncrypted || !session.remnashopRefreshTokenEncrypted) {
    authDebugLog("auth_me_local_profile_returned", {
      sessionId: session.id,
      userId: session.userId,
      authMethod: session.authMethod,
      hasRemnashopTokens: false,
    });
    return { user: localUserProfile(session) };
  }

  const { accessToken } = await getAuthorizedRemnashopTokens({
    allowUnverifiedEmail: true,
  });
  const profile = await getRemnashopMe(accessToken);
  authDebugLog("auth_me_remnashop_profile_returned", {
    sessionId: session.id,
    userId: session.userId,
    authMethod: session.authMethod,
    hasEmail: Boolean(profile.email),
    emailVerified: profile.is_email_verified,
  });

  return { user: remnashopUserProfile(session, profile) };
}

export async function requestEmailVerification(rawBody: AuthPayload<RequestEmailVerificationRequest>, turnstile: TurnstileContext) {
  const { body, turnstileToken } = stripTurnstile(rawBody);

  authDebugLog("email_verification_request_started", {
    hasEmail: Boolean(body.email),
    hasTurnstileToken: Boolean(turnstileToken ?? turnstile.token),
  });
  await verifyTurnstileToken(turnstileToken ?? turnstile.token, turnstile.remoteIp);
  authDebugLog("email_verification_request_turnstile_passed", {});

  const { accessToken, session } = await getAuthorizedRemnashopTokens({
    allowUnverifiedEmail: true,
  });
  authDebugLog("email_verification_request_session_authorized", {
    sessionId: session.id,
    userId: session.userId,
    allowUnverifiedEmail: true,
  });
  const key = `email-verification:${session.userId}`;

  await assertCooldown({
    key,
    action: "email_verification_request",
    windowSeconds: 60,
  });
  await assertRateLimit({
    action: "email_verification_request",
    email: body.email ?? session.user.email,
    tgId: session.user.telegramId,
    limit: 5,
    windowSeconds: 15 * 60,
  });
  authDebugLog("email_verification_request_rate_limit_passed", {
    sessionId: session.id,
    userId: session.userId,
  });

  const result = await requestRemnashopEmailVerification({
    accessToken,
    body,
    source: "resend",
  });
  authDebugLog("email_verification_request_success", {
    sessionId: session.id,
    userId: session.userId,
    targetEmail: result.target_email,
    expiresAt: result.expires_at,
  });

  await auditLog({
    action: "email_verification_requested",
    userId: session.userId,
    metadata: { targetEmail: result.target_email },
  });

  return result;
}

export async function confirmEmailVerification(rawBody: AuthPayload<ConfirmEmailVerificationRequest>, turnstile: TurnstileContext) {
  const { body, turnstileToken } = stripTurnstile(rawBody);
  const skipTurnstile = body.registrationFlow === true;
  delete body.registrationFlow;

  authDebugLog("email_verification_confirm_started", {
    hasEmail: Boolean(body.email),
    skipTurnstile,
    hasTurnstileToken: Boolean(turnstileToken ?? turnstile.token),
  });
  if (!skipTurnstile) {
    await verifyTurnstileToken(turnstileToken ?? turnstile.token, turnstile.remoteIp);
    authDebugLog("email_verification_confirm_turnstile_passed", {});
  }

  const { accessToken, session } = await getAuthorizedRemnashopTokens({
    allowUnverifiedEmail: true,
  });
  const profile = await getRemnashopMe(accessToken);
  const targetEmail = body.email ?? profile.pending_email ?? profile.email ?? session.user.email ?? undefined;
  const confirmBody = targetEmail ? { ...body, email: targetEmail } : body;
  authDebugLog("email_verification_confirm_target_resolved", {
    sessionId: session.id,
    userId: session.userId,
    hasTargetEmail: Boolean(targetEmail),
    sourceHasPendingEmail: Boolean(profile.pending_email),
  });

  await assertRateLimit({
    action: "email_verification_confirm",
    email: targetEmail,
    tgId: session.user.telegramId,
    limit: 5,
    windowSeconds: 15 * 60,
  });
  authDebugLog("email_verification_confirm_rate_limit_passed", {
    sessionId: session.id,
    userId: session.userId,
  });

  const result = await remnashopRequest<ConfirmEmailVerificationResponse>(
    "/auth/email/confirm",
    {
      method: "POST",
      accessToken,
      body: confirmBody,
    },
  );
  authDebugLog("email_verification_confirm_remnashop_success", {
    sessionId: session.id,
    userId: session.userId,
    email: result.email,
  });

  await prisma.webUser.update({
    where: { id: session.userId },
    data: {
      email: result.email,
      emailVerified: true,
    },
  });
  await refreshCurrentAccessCookie();
  authDebugLog("email_verification_confirm_local_user_updated", {
    sessionId: session.id,
    userId: session.userId,
    emailVerified: true,
  });

  await auditLog({
    action: "email_verified",
    userId: session.userId,
    metadata: { email: result.email },
  });

  return result;
}

export async function changeEmail(body: ChangeEmailRequest) {
  authDebugLog("email_change_started", { hasEmail: Boolean(body.email) });
  const { accessToken, session } = await getAuthorizedRemnashopTokens();
  authDebugLog("email_change_session_authorized", {
    sessionId: session.id,
    userId: session.userId,
  });

  await assertCooldown({
    key: `email-change:${session.userId}`,
    action: "email_change_request",
    windowSeconds: 60,
  });
  await assertRateLimit({
    action: "email_change_request",
    email: body.email,
    tgId: session.user.telegramId,
    limit: 5,
    windowSeconds: 15 * 60,
  });
  authDebugLog("email_change_rate_limit_passed", {
    sessionId: session.id,
    userId: session.userId,
  });

  const result = await remnashopRequest<ChangeEmailResponse>(
    "/auth/email/change",
    {
      method: "POST",
      accessToken,
      body,
    },
  );
  authDebugLog("email_change_remnashop_success", {
    sessionId: session.id,
    userId: session.userId,
    pendingEmail: result.pending_email,
  });
  const verification = await requestRemnashopEmailVerification({
    accessToken,
    body: { email: result.pending_email },
    source: "change_email",
  });
  authDebugLog("email_change_verification_requested", {
    sessionId: session.id,
    userId: session.userId,
    targetEmail: verification.target_email,
    expiresAt: verification.expires_at,
  });

  await prisma.webUser.update({
    where: { id: session.userId },
    data: { emailVerified: false },
  });

  await auditLog({
    action: "email_change_requested",
    userId: session.userId,
    metadata: { pendingEmail: result.pending_email, verificationTargetEmail: verification.target_email },
  });

  return { ...result, emailVerification: verification };
}

export async function changePassword(body: ChangePasswordRequest) {
  authDebugLog("password_change_started", {
    hasCurrentPassword: Boolean(body.current_password),
    hasNewPassword: Boolean(body.new_password),
  });
  const { accessToken, session } = await getAuthorizedRemnashopTokens();
  authDebugLog("password_change_session_authorized", {
    sessionId: session.id,
    userId: session.userId,
  });
  const result = await remnashopChangePassword(accessToken, body);
  authDebugLog("password_change_remnashop_success", {
    sessionId: session.id,
    userId: session.userId,
    success: result.data.success,
  });

  await prisma.webSession.update({
    where: { id: session.id },
    data: {
      remnashopAccessTokenEncrypted: protectRemnashopToken(result.cookies.accessToken),
      remnashopRefreshTokenEncrypted: protectRemnashopToken(result.cookies.refreshToken),
      remnashopAccessExpiresAt: getJwtExpiresAt(result.cookies.accessToken) ?? addDays(new Date(), 1),
      remnashopRefreshExpiresAt: addDays(new Date(), 30),
    },
  });
  authDebugLog("password_change_session_tokens_rotated", {
    sessionId: session.id,
    userId: session.userId,
  });

  await auditLog({ action: "password_changed", userId: session.userId });

  return result.data;
}

export async function linkRemnashopAccount(body: LoginRequest) {
  authDebugLog("remnashop_account_link_started", { hasEmail: Boolean(body.email) });
  await assertRateLimit({
    action: "remnashop_link",
    email: body.email,
    limit: 10,
    windowSeconds: 15 * 60,
  });
  authDebugLog("remnashop_account_link_rate_limit_passed", {});

  let auth: Awaited<ReturnType<typeof remnashopAuth>>;

  try {
    auth = await remnashopAuth("/auth/login", body);
    authDebugLog("remnashop_account_link_login_success", {
      accessExpiresAt: auth.data.expires_at,
      refreshExpiresAt: auth.data.refresh_expires_at,
    });
  } catch (error) {
    if (!(error instanceof BffError) || error.code !== "AUTH_FAILED") {
      throw error;
    }

    auth = await remnashopAuth("/auth/register", body);
    authDebugLog("remnashop_account_link_register_fallback_success", {
      accessExpiresAt: auth.data.expires_at,
      refreshExpiresAt: auth.data.refresh_expires_at,
    });
  }

  const verification = await requestRemnashopEmailVerification({
    accessToken: auth.cookies.accessToken,
    body: { email: body.email },
    source: "link_remnashop",
  });
  const { user, profile } = await linkCurrentUserToRemnashopAuth({
    accessToken: auth.cookies.accessToken,
    refreshToken: auth.cookies.refreshToken,
    auth: auth.data,
  });
  authDebugLog("remnashop_account_link_verification_requested", {
    userId: user.id,
    targetEmail: verification.target_email,
    expiresAt: verification.expires_at,
  });

  await auditLog({
    action: "remnashop_account_linked",
    userId: user.id,
    metadata: { email: profile.email, telegramId: profile.telegram_id, verificationTargetEmail: verification.target_email },
  });

  return {
    user: profile,
    emailVerification: verification,
    linked: true,
  };
}
