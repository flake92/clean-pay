import type { CheckoutReader, PaymentCommands } from "@/application/payments/ports/checkout";
import type { CheckoutViewModel, PaymentCommand, PaymentCommandResult } from "@/application/models/checkout";
import type { AuthProfileGateway } from "@/application/auth/ports/auth-profile";
import { AuthProfileError } from "@/application/auth/ports/auth-profile";
import { resolveAuthProfile } from "@/application/auth/resolve-auth-profile";

export async function loadCheckout(reader: CheckoutReader, auth: AuthProfileGateway): Promise<CheckoutViewModel> {
  try {
    const account = await resolveAuthProfile(auth);
    if (account.accountSyncPending) return { status: "account-action-required", action: "verifyEmail", message: "Дождитесь завершения подтверждения e-mail." };
    if (!account.emailVerified) return { status: "account-action-required", action: "linkEmail", message: "Для оплаты добавьте e-mail и пароль, затем подтвердите адрес кодом из письма." };
    return { status: "ready", offers: await reader.loadOffers() };
  } catch (error) {
    if (error instanceof AuthProfileError && error.code === "UNAUTHORIZED") {
      return { status: "account-action-required", action: "login", message: "Нужно войти в аккаунт." };
    }
    return { status: "error", message: "Не удалось загрузить данные оплаты." };
  }
}

export async function executePayment(commands: PaymentCommands, command: PaymentCommand): Promise<PaymentCommandResult> {
  if (!command.idempotencyKey) return { ok: false, code: "IDEMPOTENCY_KEY_REQUIRED", message: "Не удалось безопасно начать оплату.", retainIdempotencyKey: false };
  try {
    const result = command.kind === "purchase"
      ? await commands.purchase(command.request, command.idempotencyKey)
      : await commands.extend(command.request, command.idempotencyKey);
    return { ok: true, ...result };
  } catch (error) {
    const candidate = error as { code?: unknown };
    const code = typeof candidate?.code === "string" ? candidate.code : "INTERNAL_ERROR";
    const messages: Record<string, string> = {
      OFFER_CHANGED: "Цена или условия предложения изменились. Проверьте новую цену перед оплатой.",
      PLAN_UNAVAILABLE: "Выбранное предложение больше недоступно.",
      PAYMENT_GATEWAY_UNAVAILABLE: "Выбранный способ оплаты больше недоступен.",
      IDEMPOTENCY_KEY_INVALID: "Не удалось безопасно начать оплату. Обновите страницу и попробуйте снова.",
      EMAIL_REQUIRED: "Добавьте e-mail и пароль, чтобы продолжить.",
      EMAIL_NOT_VERIFIED: "Подтвердите e-mail, чтобы продолжить.",
      RATE_LIMITED: "Слишком много попыток. Попробуйте позже.",
    };
    const finalCodes = new Set(["OFFER_CHANGED", "PLAN_UNAVAILABLE", "PAYMENT_GATEWAY_UNAVAILABLE", "IDEMPOTENCY_KEY_INVALID", "IDEMPOTENCY_KEY_REUSED", "VALIDATION_ERROR"]);
    return { ok: false, code, message: messages[code] ?? "Не удалось подтвердить результат оплаты. Повторите попытку с тем же запросом.", retainIdempotencyKey: !finalCodes.has(code) };
  }
}
