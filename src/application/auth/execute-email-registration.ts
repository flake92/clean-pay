import {
  AuthGatewayError,
  type AuthCommands,
  type AuthProviderSession,
} from "@/application/auth/ports/auth-commands";
import type { AuthExecutionResult } from "@/application/models/auth-actions";

export type EmailRegistrationCommands = Pick<
  AuthCommands,
  | "audit"
  | "authenticate"
  | "establishSession"
  | "preflightCapacity"
  | "rateLimit"
  | "requestEmailVerification"
  | "verifyHuman"
  | "withUpstreamConcurrency"
>;

type EmailRegistrationInput = {
  email: string;
  password: string;
  referralCode?: string;
  turnstileToken: string | null;
};

type EmailRegistrationResult = Extract<
  AuthExecutionResult,
  { kind: "authenticated"; ok: true }
> & { registrationFlow: "created" | "existing_email_login" };

export async function executeEmailRegistration(
  commands: EmailRegistrationCommands,
  input: EmailRegistrationInput,
): Promise<EmailRegistrationResult> {
  const { email, password, referralCode, turnstileToken } = input;
  await commands.preflightCapacity("auth_command");
  await commands.withUpstreamConcurrency(
    "turnstile_verify",
    () => commands.verifyHuman(turnstileToken, "auth_login"),
  );
  await commands.rateLimit({
    action: "auth_register",
    email,
    limit: 5,
    windowSeconds: 15 * 60,
  });

  let providerSession: AuthProviderSession;
  let flow: "created" | "existing_email_login" = "created";
  try {
    providerSession = await commands.withUpstreamConcurrency(
      "remnashop_auth",
      () => commands.authenticate({
        operation: "register",
        email,
        password,
        ...(referralCode ? { referralCode } : {}),
      }),
    );
  } catch (error) {
    if (!(error instanceof AuthGatewayError) || error.code !== "EMAIL_ALREADY_EXISTS") throw error;
    flow = "existing_email_login";
    providerSession = await commands.withUpstreamConcurrency(
      "remnashop_auth",
      () => commands.authenticate({
        operation: "login",
        email,
        password,
      }),
    );
  }

  const session = await commands.withUpstreamConcurrency(
    "remnashop_auth",
    () => commands.establishSession(providerSession),
  );
  let verificationDelivery: "not_required" | "sent" | "failed" = "not_required";
  if (!session.emailVerified) {
    try {
      await commands.withUpstreamConcurrency(
        "remnashop_auth",
        () => commands.requestEmailVerification(providerSession, email),
      );
      verificationDelivery = "sent";
    } catch {
      verificationDelivery = "failed";
    }
  }
  await commands.audit({
    action: "auth_register_success",
    userId: session.userId,
    metadata: { flow, verificationDelivery },
  });

  return {
    ok: true,
    kind: "authenticated",
    emailVerified: session.emailVerified,
    registrationFlow: flow,
    verificationRequired: !session.emailVerified,
    verificationDeliveryFailed: verificationDelivery === "failed",
  };
}
