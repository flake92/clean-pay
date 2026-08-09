import type { EmailVerificationCommands } from "@/application/auth/ports/email-verification";
import type { AccountReadiness, EmailVerificationResult } from "@/application/models/email-verification";

function failure(error: unknown, fallback: string): EmailVerificationResult {
  const candidate = error as { code?: unknown };
  const code = typeof candidate?.code === "string" ? candidate.code : "INTERNAL_ERROR";
  const messages: Record<string, string> = {
    EMAIL_REQUIRED: "Сначала добавьте e-mail и пароль к аккаунту.",
    EMAIL_CODE_INVALID: "Код не подошёл. Проверьте его и попробуйте снова.",
    EMAIL_CODE_EXPIRED: "Код истёк. Запросите новый.",
    RATE_LIMITED: "Слишком много попыток. Попробуйте позже.",
  };
  return { ok: false, code, message: messages[code] ?? fallback };
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
