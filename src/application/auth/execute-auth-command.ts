import {
  AuthGatewayError,
  type AuthCommands,
  type AuthProviderSession,
} from "@/application/auth/ports/auth-commands";
import type { AuthCommand, AuthCommandResult } from "@/application/models/auth-actions";

function errorResult(error: unknown): AuthCommandResult {
  const code = error instanceof AuthGatewayError ? error.code : "INTERNAL_ERROR";
  const messages: Record<string, string> = {
    AUTH_FAILED: "Неверный e-mail или пароль.",
    RATE_LIMITED: "Слишком много попыток. Попробуйте позже.",
    VALIDATION_ERROR: "Проверьте введённые данные.",
    EMAIL_CODE_INVALID: "Код не подошёл. Проверьте его и попробуйте снова.",
    EMAIL_CODE_EXPIRED: "Код истёк. Запросите новый.",
    UPSTREAM_UNAVAILABLE: "Сервис временно недоступен. Попробуйте позже.",
  };
  return { ok: false, code, message: messages[code] ?? "Не удалось выполнить действие." };
}

function token(command: AuthCommand) {
  return command.turnstileToken ?? null;
}

async function authenticate(
  commands: AuthCommands,
  input: { operation: "login" | "register"; email: string; password: string },
) {
  return commands.authenticate(input);
}

async function register(commands: AuthCommands, email: string, password: string) {
  let providerSession: AuthProviderSession;
  let flow: "created" | "existing_email_login" = "created";
  try {
    providerSession = await authenticate(commands, { operation: "register", email, password });
  } catch (error) {
    if (!(error instanceof AuthGatewayError) || error.code !== "EMAIL_ALREADY_EXISTS") throw error;
    flow = "existing_email_login";
    providerSession = await authenticate(commands, { operation: "login", email, password });
  }

  const session = await commands.establishSession(providerSession);
  if (!session.emailVerified) await commands.requestEmailVerification(providerSession, email);
  await commands.audit({
    action: "auth_register_success",
    userId: session.userId,
    metadata: { flow },
  });
  return {
    emailVerified: session.emailVerified,
    verificationRequired: !session.emailVerified,
  };
}

export async function executeAuthCommand(commands: AuthCommands, command: AuthCommand): Promise<AuthCommandResult> {
  const email = command.email.trim().toLowerCase();
  if (!email) return { ok: false, code: "VALIDATION_ERROR", message: "Укажите e-mail." };

  try {
    await commands.verifyHuman(token(command), "auth_login");
    switch (command.kind) {
      case "identify": {
        await commands.rateLimit({ action: "auth_identify", email, limit: 20, windowSeconds: 15 * 60 });
        const [identity, hasPasskey] = await Promise.all([
          commands.identifyEmail(email),
          commands.hasPasskey(email),
        ]);
        return { ok: true, kind: "identified", exists: identity.exists, hasPasskey };
      }
      case "login": {
        await commands.rateLimit({ action: "auth_login", email, limit: 5, windowSeconds: 15 * 60 });
        const providerSession = await authenticate(commands, { operation: "login", email, password: command.password });
        const session = await commands.establishSession(providerSession);
        await commands.audit({ action: "auth_login_success", userId: session.userId });
        return { ok: true, kind: "authenticated", emailVerified: session.emailVerified, verificationRequired: false };
      }
      case "register": {
        if (command.password.length < 8) return { ok: false, code: "VALIDATION_ERROR", message: "Пароль должен содержать не менее 8 символов." };
        await commands.rateLimit({ action: "auth_register", email, limit: 5, windowSeconds: 15 * 60 });
        return { ok: true, kind: "authenticated", ...await register(commands, email, command.password) };
      }
      case "request-password-reset":
        await commands.rateLimit({ action: "password_reset_start", email, limit: 5, windowSeconds: 15 * 60 });
        await commands.requestPasswordReset(email);
        return { ok: true, kind: "password-reset-requested" };
      case "confirm-password-reset": {
        await commands.rateLimit({ action: "password_reset_confirm", email, limit: 5, windowSeconds: 15 * 60 });
        const providerSession = await commands.authenticate({
          operation: "confirm-password-reset",
          email,
          code: command.code,
          password: command.newPassword,
        });
        const session = await commands.establishSession(providerSession, {
          replaceExistingSessions: true,
          replacementIdentityEmail: email,
        });
        await commands.audit({ action: "password_reset_success", userId: session.userId });
        return { ok: true, kind: "authenticated", emailVerified: session.emailVerified, verificationRequired: false };
      }
    }
  } catch (error) {
    return errorResult(error);
  }
}
