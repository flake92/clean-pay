import type { EmailReminderPreferenceCommandResult } from "@/application/models/profile";
import {
  EmailReminderPreferenceGatewayError,
  type EmailReminderPreferenceCommands,
} from "@/application/profile/ports/email-reminder-preferences";

function failure(error: unknown): EmailReminderPreferenceCommandResult {
  const code = error instanceof EmailReminderPreferenceGatewayError
    ? error.code
    : "INTERNAL_ERROR";
  const messages: Record<string, string> = {
    EMAIL_NOT_VERIFIED: "Подтвердите e-mail, прежде чем включать напоминания.",
    EMAIL_REQUIRED: "Добавьте и подтвердите e-mail, прежде чем включать напоминания.",
    RATE_LIMITED: "Слишком много изменений. Попробуйте позже.",
    UNAUTHORIZED: "Сессия истекла. Войдите снова.",
    UPSTREAM_UNAVAILABLE: "Настройки уведомлений временно недоступны. Попробуйте позже.",
    VALIDATION_ERROR: "Не удалось применить настройку уведомлений.",
  };

  return {
    ok: false,
    code,
    message: messages[code] ?? "Не удалось изменить настройку уведомлений.",
  };
}

export async function updateEmailReminderPreference(
  commands: EmailReminderPreferenceCommands,
  enabled: unknown,
): Promise<EmailReminderPreferenceCommandResult> {
  if (typeof enabled !== "boolean") {
    return failure(new EmailReminderPreferenceGatewayError("VALIDATION_ERROR"));
  }

  try {
    const actor = await commands.loadActor();
    await commands.assertRateLimit(actor);
    const preference = await commands.update(actor, enabled);
    if (preference.enabled !== enabled) {
      throw new EmailReminderPreferenceGatewayError("UPSTREAM_UNAVAILABLE");
    }

    return {
      ok: true,
      preference,
      message: enabled
        ? "Напоминания включены. Если письмо попадёт в «Спам», отметьте его как «Не спам» и добавьте отправителя в контакты или белый список."
        : "Напоминания по e-mail отключены.",
    };
  } catch (error) {
    return failure(error);
  }
}
