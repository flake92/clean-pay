import type { AuthCommands } from "@/application/auth/ports/auth-commands";
import type { AuthExecutionResult } from "@/application/models/auth-actions";

export type EmailLoginCommands = Pick<
  AuthCommands,
  | "audit"
  | "authenticate"
  | "establishSession"
  | "preflightCapacity"
  | "rateLimit"
  | "verifyHuman"
  | "withUpstreamConcurrency"
>;

type EmailLoginInput = {
  email: string;
  password: string;
  turnstileToken: string | null;
};

type EmailLoginResult = Extract<
  AuthExecutionResult,
  { kind: "authenticated"; ok: true }
>;

export async function executeEmailLogin(
  commands: EmailLoginCommands,
  input: EmailLoginInput,
): Promise<EmailLoginResult> {
  await commands.preflightCapacity("auth_command");
  await commands.withUpstreamConcurrency(
    "turnstile_verify",
    () => commands.verifyHuman(input.turnstileToken, "auth_login"),
  );
  await commands.rateLimit({
    action: "auth_login",
    email: input.email,
    limit: 5,
    windowSeconds: 15 * 60,
  });
  const providerSession = await commands.withUpstreamConcurrency(
    "remnashop_auth",
    () => commands.authenticate({
      operation: "login",
      email: input.email,
      password: input.password,
    }),
  );
  const session = await commands.withUpstreamConcurrency(
    "remnashop_auth",
    () => commands.establishSession(providerSession),
  );
  await commands.audit({ action: "auth_login_success", userId: session.userId });

  return {
    ok: true,
    kind: "authenticated",
    emailVerified: session.emailVerified,
    verificationRequired: !session.emailVerified,
    verificationDeliveryFailed: false,
  };
}
