import type { AuthCommands } from "@/application/auth/ports/auth-commands";
import type { AuthCommand, AuthCommandResult } from "@/application/models/auth-actions";

function errorResult(error: unknown): AuthCommandResult {
  const candidate = error as { code?: unknown };
  const code = typeof candidate?.code === "string" ? candidate.code : "INTERNAL_ERROR";
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

export async function executeAuthCommand(commands: AuthCommands, command: AuthCommand): Promise<AuthCommandResult> {
  const email = command.email.trim().toLowerCase();
  if (!email) return { ok: false, code: "VALIDATION_ERROR", message: "Укажите e-mail." };

  try {
    switch (command.kind) {
      case "identify": {
        const result = await commands.identify({ email, ...(command.turnstileToken ? { turnstileToken: command.turnstileToken } : {}) });
        return { ok: true, kind: "identified", ...result };
      }
      case "login":
        await commands.login({ email, password: command.password, ...(command.turnstileToken ? { turnstileToken: command.turnstileToken } : {}) });
        return { ok: true, kind: "authenticated", emailVerified: true, verificationRequired: false };
      case "register": {
        if (command.password.length < 8) return { ok: false, code: "VALIDATION_ERROR", message: "Пароль должен содержать не менее 8 символов." };
        const result = await commands.register({ email, password: command.password, ...(command.turnstileToken ? { turnstileToken: command.turnstileToken } : {}) });
        return { ok: true, kind: "authenticated", ...result };
      }
      case "request-password-reset":
        await commands.requestPasswordReset({ email, ...(command.turnstileToken ? { turnstileToken: command.turnstileToken } : {}) });
        return { ok: true, kind: "password-reset-requested" };
      case "confirm-password-reset":
        await commands.confirmPasswordReset({ email, code: command.code, newPassword: command.newPassword, ...(command.turnstileToken ? { turnstileToken: command.turnstileToken } : {}) });
        return { ok: true, kind: "authenticated", emailVerified: true, verificationRequired: false };
    }
  } catch (error) {
    return errorResult(error);
  }
}
