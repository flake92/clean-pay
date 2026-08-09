import { ProfileGatewayError, type ProfileCommands } from "@/application/profile/ports/profile-commands";
import type { ProfileCommandResult } from "@/application/models/profile";
import type { EmailVerificationCommands } from "@/application/auth/ports/email-verification";
import { changeVerifiedEmail, requestEmailVerificationCode } from "@/application/auth/execute-email-verification";

function failure(error: unknown, fallback: string): ProfileCommandResult {
  const candidate = error as { code?: unknown; message?: unknown };
  const code = typeof candidate?.code === "string" ? candidate.code : "INTERNAL_ERROR";
  const messages: Record<string, string> = {
    CURRENT_PASSWORD_INVALID: "Текущий пароль неверный.",
    EMAIL_REQUIRED: "Чтобы привязать e-mail к Telegram-аккаунту, используйте раздел «Связать аккаунт».",
    CONFLICT: "Этот e-mail уже используется другим аккаунтом.",
    RATE_LIMITED: "Слишком много попыток. Попробуйте позже.",
    VALIDATION_ERROR: "Проверьте введённые данные.",
  };
  return { ok: false, code, message: messages[code] ?? fallback };
}

export async function requestProfileEmailVerification(
  commands: EmailVerificationCommands,
  input: { email?: string; turnstileToken?: string },
): Promise<ProfileCommandResult> {
  try {
    const result = await requestEmailVerificationCode(commands, input);
    if (!result.ok) return result;
    if (result.kind !== "code-sent") {
      return { ok: false, code: "INTERNAL_ERROR", message: "Не удалось отправить код." };
    }
    return { ok: true, message: `Код подтверждения отправлен на ${result.targetEmail}.`, targetEmail: result.targetEmail };
  } catch (error) {
    return failure(error, "Не удалось отправить код.");
  }
}

export async function changeProfileEmail(
  commands: EmailVerificationCommands,
  input: { email: string; turnstileToken?: string },
): Promise<ProfileCommandResult> {
  if (!input.email.trim()) return { ok: false, code: "VALIDATION_ERROR", message: "Укажите e-mail." };
  try {
    const result = await changeVerifiedEmail(commands, input);
    if (!result.ok) return result;
    if (result.kind !== "code-sent") return { ok: false, code: "INTERNAL_ERROR", message: "Не удалось изменить e-mail." };
    return { ok: true, message: `Новый e-mail сохранён. Код подтверждения отправлен на ${result.targetEmail}.`, targetEmail: result.targetEmail };
  } catch (error) {
    return failure(error, "Не удалось изменить e-mail.");
  }
}

export async function changeProfilePassword(
  commands: ProfileCommands,
  input: { currentPassword: string; newPassword: string },
): Promise<ProfileCommandResult> {
  if (!input.currentPassword || input.newPassword.length < 8) {
    return { ok: false, code: "VALIDATION_ERROR", message: "Проверьте текущий и новый пароль." };
  }
  try {
    const session = await commands.loadPasswordSession();
    let changed: { context: unknown };
    try {
      changed = await commands.changeProviderPassword(session, input);
    } catch (error) {
      if (!(error instanceof ProfileGatewayError) || error.code !== "CURRENT_PASSWORD_INVALID") throw error;
      const refreshed = await commands.refreshProviderSession(session);
      await commands.persistRefreshedProviderSession(session, refreshed);
      changed = await commands.changeProviderPassword(refreshed, input);
    }
    await commands.replaceLocalPasswordSession(session, changed);
    await commands.auditPasswordChanged(session.userId);
    return { ok: true, message: "Пароль изменён." };
  } catch (error) {
    return failure(error, "Не удалось изменить пароль.");
  }
}
