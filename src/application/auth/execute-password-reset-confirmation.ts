import type { AuthCommands } from "@/application/auth/ports/auth-commands";
import type { AuthExecutionResult } from "@/application/models/auth-actions";

export type PasswordResetConfirmationCommands = Pick<
  AuthCommands,
  | "audit"
  | "authenticate"
  | "establishSession"
  | "preflightCapacity"
  | "rateLimit"
  | "verifyHuman"
  | "withUpstreamConcurrency"
>;

type PasswordResetConfirmationInput = {
  code: string;
  email: string;
  newPassword: string;
  turnstileToken: string | null;
};

type PasswordResetConfirmationResult = Extract<
  AuthExecutionResult,
  { kind: "authenticated"; ok: true }
>;

export async function executePasswordResetConfirmation(
  commands: PasswordResetConfirmationCommands,
  input: PasswordResetConfirmationInput,
): Promise<PasswordResetConfirmationResult> {
  await commands.preflightCapacity("auth_command");
  await commands.withUpstreamConcurrency(
    "turnstile_verify",
    () => commands.verifyHuman(input.turnstileToken, "auth_login"),
  );
  await commands.rateLimit({
    action: "password_reset_confirm",
    email: input.email,
    limit: 5,
    windowSeconds: 15 * 60,
  });
  const providerSession = await commands.withUpstreamConcurrency(
    "remnashop_auth",
    () => commands.authenticate({
      operation: "confirm-password-reset",
      email: input.email,
      code: input.code,
      password: input.newPassword,
    }),
  );
  const session = await commands.withUpstreamConcurrency(
    "remnashop_auth",
    () => commands.establishSession(providerSession, {
      replaceExistingSessions: true,
      replacementIdentityEmail: input.email,
    }),
  );
  await commands.audit({ action: "password_reset_success", userId: session.userId });

  return {
    ok: true,
    kind: "authenticated",
    emailVerified: session.emailVerified,
    verificationRequired: !session.emailVerified,
    verificationDeliveryFailed: false,
  };
}
