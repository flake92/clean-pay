import type { EmailVerificationCommands } from "@/backend/application/auth/ports/email-verification";
import { ServiceError } from "@/backend/errors/service-error";
import type { AccountReadiness, EmailVerificationResult } from "@/shared/presentation/email-verification";

function failure(error: unknown, fallback: string): EmailVerificationResult {
  const code = error instanceof ServiceError ? error.code : "INTERNAL_ERROR";
  const messages: Record<string, string> = {
    EMAIL_REQUIRED: "Сначала добавьте e-mail и пароль к аккаунту.",
    EMAIL_CODE_INVALID: "Код не подошёл. Проверьте его и попробуйте снова.",
    EMAIL_CODE_EXPIRED: "Код истёк. Запросите новый.",
    RATE_LIMITED: "Слишком много попыток. Попробуйте позже.",
  };
  const message = messages[code] ?? (error instanceof ServiceError ? error.prodMessage : null) ?? fallback;
  return { ok: false, code, message };
}

export async function requestEmailVerificationCode(
  commands: EmailVerificationCommands,
  input: { email?: string; turnstileToken?: string },
): Promise<EmailVerificationResult> {
  try {
    const result = await commands.requestCode(input);
    return { ok: true, kind: "code-sent", targetEmail: result.targetEmail };
  } catch (error) {
    return failure(error, "Не удалось отправить код.");
  }
}

export async function confirmEmailVerificationCode(
  commands: EmailVerificationCommands,
  input: { email?: string; code: string; turnstileToken?: string },
): Promise<EmailVerificationResult> {
  if (!/^\d{6}$/.test(input.code)) return { ok: false, code: "VALIDATION_ERROR", message: "Введите код из 6 цифр." };
  try {
    const confirmed = await commands.confirmCode(input);
    const readiness = confirmed.accountSyncPending
      ? await safeReadiness(commands)
      : { status: "ready" as const };
    return { ok: true, kind: "confirmed", readiness };
  } catch (error) {
    return failure(error, "Не удалось подтвердить e-mail.");
  }
}

export async function safeReadiness(commands: EmailVerificationCommands): Promise<AccountReadiness> {
  try { return await commands.checkReadiness(); }
  catch { return { status: "unavailable" }; }
}
