import {
  AuthGatewayError,
  type AuthCommands,
  type AuthProviderSession,
} from "@/application/auth/ports/auth-commands";
import { ServiceError } from "@/backend/errors/service-error";
import { prismaPasskeyAccountReader } from "@/backend/integrations/auth/prisma-passkey-account-reader";
import { requestRemnashopEmailVerification } from "@/backend/integrations/auth/email-verification-delivery";
import {
  remnashopAuth,
  remnashopIdentifyEmail,
  remnashopRequestPasswordReset,
} from "@/backend/integrations/remnashop/client";
import { createSessionFromRemnashopAuth } from "@/backend/integrations/remnashop/session";
import {
  assertRateLimitCapacity,
  assertTargetRateLimit,
  withAuthConcurrency,
} from "@/backend/limits/rate-limit";
import { auditLog } from "@/backend/observability/audit";
import { verifyTurnstileToken } from "@/backend/security/turnstile";

type ProviderAuth = Awaited<ReturnType<typeof remnashopAuth>>;

function providerAuth(session: AuthProviderSession) {
  return session.context as ProviderAuth;
}

function emailAlreadyExists(error: unknown) {
  return error instanceof ServiceError
    && error.code === "CONFLICT"
    && String(error.debug?.message ?? error.message).toLowerCase().includes("email already exists");
}

async function adapt<T>(work: () => Promise<T>): Promise<T> {
  try {
    return await work();
  } catch (error) {
    if (error instanceof AuthGatewayError) throw error;
    if (error instanceof ServiceError) throw new AuthGatewayError(error.code);
    throw new AuthGatewayError("INTERNAL_ERROR");
  }
}

export function createProductionAuthCommands(): AuthCommands {
  return {
    preflightCapacity: (action) => adapt(() => assertRateLimitCapacity(action)),
    withUpstreamConcurrency: (action, work) => adapt(() => withAuthConcurrency(action, work)),
    verifyHuman: (token, action) => adapt(() => verifyTurnstileToken(token, action)),
    rateLimit: (input) => adapt(() => assertTargetRateLimit(input)),
    identifyEmail: (email) => adapt(() => remnashopIdentifyEmail({ email })),
    hasPasskey: (email) => adapt(() => prismaPasskeyAccountReader.hasCredential(email)),
    async authenticate(input) {
      try {
        const auth = input.operation === "confirm-password-reset"
          ? await remnashopAuth(
              "/auth/password/confirm-reset",
              { email: input.email, code: input.code!, new_password: input.password! },
            )
          : await remnashopAuth(
              input.operation === "register" ? "/auth/register" : "/auth/login",
              input.operation === "register"
                ? {
                    email: input.email,
                    password: input.password,
                    ...(input.referralCode ? { referral_code: input.referralCode } : {}),
                  }
                : { email: input.email, password: input.password },
            );
        return { context: auth };
      } catch (error) {
        if (input.operation === "register" && emailAlreadyExists(error)) {
          throw new AuthGatewayError("EMAIL_ALREADY_EXISTS");
        }
        if (error instanceof ServiceError) throw new AuthGatewayError(error.code);
        throw new AuthGatewayError("INTERNAL_ERROR");
      }
    },
    async establishSession(providerSession, options) {
      return adapt(async () => {
        const auth = providerAuth(providerSession);
        const { user, profile } = await createSessionFromRemnashopAuth({
          accessToken: auth.cookies.accessToken,
          refreshToken: auth.cookies.refreshToken,
          auth: auth.data,
          ...options,
        });
        return { userId: user.id, emailVerified: profile.is_email_verified === true };
      });
    },
    async requestEmailVerification(providerSession, email) {
      await adapt(async () => {
        const auth = providerAuth(providerSession);
        await requestRemnashopEmailVerification({
          accessToken: auth.cookies.accessToken,
          body: { email },
          source: "register",
        });
      });
    },
    async requestPasswordReset(email) {
      await adapt(() => remnashopRequestPasswordReset({ email }));
    },
    audit: auditLog,
  };
}
