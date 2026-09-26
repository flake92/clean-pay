import type { AuthCommands } from "@/application/auth/ports/auth-commands";
import type { AuthExecutionResult } from "@/application/models/auth-actions";

export type PasswordResetStartCommands = Pick<
  AuthCommands,
  | "preflightCapacity"
  | "rateLimit"
  | "requestPasswordReset"
  | "verifyHuman"
  | "withUpstreamConcurrency"
>;

type PasswordResetStartInput = {
  email: string;
  turnstileToken: string | null;
};

type PasswordResetStartResult = Extract<
  AuthExecutionResult,
  { kind: "password-reset-requested"; ok: true }
>;

export async function executePasswordResetStart(
  commands: PasswordResetStartCommands,
  input: PasswordResetStartInput,
): Promise<PasswordResetStartResult> {
  await commands.preflightCapacity("auth_command");
  await commands.withUpstreamConcurrency(
    "turnstile_verify",
    () => commands.verifyHuman(input.turnstileToken, "auth_login"),
  );
  await commands.rateLimit({
    action: "password_reset_start",
    email: input.email,
    limit: 5,
    windowSeconds: 15 * 60,
  });
  await commands.withUpstreamConcurrency(
    "remnashop_auth",
    () => commands.requestPasswordReset(input.email),
  );

  return { ok: true, kind: "password-reset-requested" };
}
