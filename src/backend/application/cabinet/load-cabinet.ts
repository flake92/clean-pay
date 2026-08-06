import type { CabinetReader } from "@/backend/application/cabinet/ports/cabinet-reader";
import type { CabinetViewModel } from "@/shared/presentation/cabinet";

export async function loadCabinetViewModel(reader: CabinetReader): Promise<CabinetViewModel> {
  let account: Awaited<ReturnType<CabinetReader["loadUser"]>>;
  try {
    account = await reader.loadUser();
  } catch {
    return { status: "error", message: "Нужно войти в аккаунт." };
  }

  const [subscription, offers, devices, payments, support] = await Promise.allSettled([
    reader.loadSubscription(),
    reader.loadOffers(),
    reader.loadDevices(),
    reader.loadPayments(account.id),
    reader.loadSupport(),
  ]);

  return {
    status: "ready",
    user: account.profile,
    subscription: subscription.status === "fulfilled" ? subscription.value : null,
    subscriptionError: subscription.status === "rejected" ? "Не удалось загрузить подписку." : null,
    offers: offers.status === "fulfilled" ? offers.value : null,
    devices: devices.status === "fulfilled" ? devices.value : null,
    payments: payments.status === "fulfilled" ? payments.value.records : [],
    paymentsWarning: payments.status === "rejected"
      ? "Не удалось обновить историю платежей."
      : payments.value.stale
        ? "История показана из сохранённых данных. Обновление статусов временно недоступно."
        : null,
    support: support.status === "fulfilled"
      ? support.value
      : { enabled: false, email: null, telegramUsername: null, faqUrl: null },
  };
}
