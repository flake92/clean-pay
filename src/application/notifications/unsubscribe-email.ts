import type { EmailUnsubscribeResult } from "@/application/models/notifications";
import {
  NotificationChannelGatewayError,
  type EmailUnsubscribeGateway,
} from "@/application/notifications/ports/notification-channels";

// Shape check only; the signature is verified by Remnashop.
const TOKEN = /^[1-9][0-9]{0,11}\.[SN]\.[0-9a-f]{32}$/;

export function isWellFormedUnsubscribeToken(value: unknown): value is string {
  return typeof value === "string" && TOKEN.test(value);
}

export async function unsubscribeEmail(
  gateway: EmailUnsubscribeGateway,
  token: unknown,
): Promise<EmailUnsubscribeResult> {
  if (!isWellFormedUnsubscribeToken(token)) {
    return {
      ok: false,
      code: "INVALID_TOKEN",
      message: "Ссылка для отписки повреждена. Откройте её из письма ещё раз или измените настройки в профиле.",
    };
  }
  try {
    const category = await gateway.unsubscribe(token);
    return {
      ok: true,
      category,
      message: category === "news"
        ? "Вы отписались от новостей и рассылок по e-mail."
        : "Вы отписались от служебных писем. Уведомления останутся в Telegram и push.",
    };
  } catch (error) {
    const code = error instanceof NotificationChannelGatewayError ? error.code : "INTERNAL_ERROR";
    return {
      ok: false,
      code,
      message: code === "INVALID_TOKEN"
        ? "Ссылка для отписки недействительна. Измените настройки в профиле."
        : "Не удалось отписаться. Попробуйте позже или измените настройки в профиле.",
    };
  }
}
