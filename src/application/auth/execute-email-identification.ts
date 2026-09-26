import type { AuthCommands } from "@/application/auth/ports/auth-commands";
import type { AuthExecutionResult } from "@/application/models/auth-actions";

export type EmailIdentificationCommands = Pick<
  AuthCommands,
  | "hasPasskey"
  | "identifyEmail"
  | "preflightCapacity"
  | "rateLimit"
  | "verifyHuman"
  | "withUpstreamConcurrency"
>;

type EmailIdentificationInput = {
  email: string;
  turnstileToken: string | null;
};

type EmailIdentificationResult = Extract<
  AuthExecutionResult,
  { kind: "identified"; ok: true }
>;

export async function executeEmailIdentification(
  commands: EmailIdentificationCommands,
  input: EmailIdentificationInput,
): Promise<EmailIdentificationResult> {
  const { email, turnstileToken } = input;
  await commands.preflightCapacity("auth_command");
  await commands.withUpstreamConcurrency(
    "turnstile_verify",
    () => commands.verifyHuman(turnstileToken, "auth_login"),
  );
  await commands.rateLimit({
    action: "auth_identify",
    email,
    limit: 20,
    windowSeconds: 15 * 60,
  });
  const [identity, hasPasskey] = await Promise.all([
    commands.withUpstreamConcurrency(
      "remnashop_auth",
      () => commands.identifyEmail(email),
    ),
    commands.hasPasskey(email),
  ]);

  return { ok: true, kind: "identified", exists: identity.exists, hasPasskey };
}
