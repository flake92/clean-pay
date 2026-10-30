import type {
  EmailPreferenceChannel,
  EmailReminderPreferenceCommandResult,
} from "@/application/models/profile";
import {
  EmailReminderPreferenceGatewayError,
  type EmailReminderPreferenceCommands,
} from "@/application/profile/ports/email-reminder-preferences";

function failure(error: unknown): EmailReminderPreferenceCommandResult {
  const code = error instanceof EmailReminderPreferenceGatewayError
    ? error.code
    : "INTERNAL_ERROR";
  const messages: Record<string, string> = {
    EMAIL_NOT_VERIFIED: "Подтвердите e-mail, прежде чем включать письма.",
    EMAIL_REQUIRED: "Добавьте и подтвердите e-mail, прежде чем включать письма.",
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

const SPAM_HINT =
  " Если письмо попадёт в «Спам», отметьте его как «Не спам» и добавьте отправителя в контакты.";

function successMessage(channel: EmailPreferenceChannel, enabled: boolean) {
  if (channel === "news") {
    return enabled
      ? `Вы подписались на новости и рассылки по e-mail.${SPAM_HINT}`
      : "Вы отписались от новостей по e-mail.";
  }
  return enabled
    ? `Служебные письма включены: напоминания об окончании подписки и уведомления об аккаунте.${SPAM_HINT}`
    : "Служебные письма отключены. Уведомления останутся в Telegram и push.";
}

export async function updateEmailReminderPreference(
  commands: EmailReminderPreferenceCommands,
  channel: unknown,
  enabled: unknown,
): Promise<EmailReminderPreferenceCommandResult> {
  if ((channel !== "service" && channel !== "news") || typeof enabled !== "boolean") {
    return failure(new EmailReminderPreferenceGatewayError("VALIDATION_ERROR"));
  }

  try {
    const actor = await commands.loadActor();
    await commands.assertRateLimit(actor);
    const preference = await commands.update(actor, channel, enabled);
    const stored = channel === "news" ? preference.newsEnabled : preference.serviceEnabled;
    if (stored !== enabled) {
      throw new EmailReminderPreferenceGatewayError("UPSTREAM_UNAVAILABLE");
    }

    return { ok: true, preference, message: successMessage(channel, enabled) };
  } catch (error) {
    return failure(error);
  }
}
