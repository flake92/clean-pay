import type { CabinetReader } from "@/application/cabinet/ports/cabinet-reader";
import type { CabinetViewModel } from "@/application/models/cabinet";
import type { PaymentHistoryGateway } from "@/application/payments/ports/payment-history";
import { loadPaymentHistory } from "@/application/payments/load-payment-history";
import type { AuthProfileGateway } from "@/application/auth/ports/auth-profile";
import { AuthProfileError } from "@/application/auth/ports/auth-profile";
import { resolveAuthProfile } from "@/application/auth/resolve-auth-profile";
import { isProviderSessionRecoveryRequired } from "@/shared/domain/provider-session-recovery";

export async function loadCabinetViewModel(reader: CabinetReader, auth: AuthProfileGateway, history: PaymentHistoryGateway): Promise<CabinetViewModel> {
  let account;
  try {
    account = await resolveAuthProfile(auth);
  } catch (error) {
    if (error instanceof AuthProfileError && error.code === "UNAUTHORIZED") {
      return { status: "unauthorized" };
    }
    if (error instanceof AuthProfileError && error.code === "PROVIDER_SESSION_RECOVERY_REQUIRED") {
      return { status: "provider-session-recovery-required" };
    }
    return { status: "error", message: "Не удалось загрузить данные аккаунта. Попробуйте позже." };
  }

  const [subscription, offers, devices, payments, support] = await Promise.allSettled([
    reader.loadSubscription(),
    reader.loadOffers(),
    reader.loadDevices(),
    loadPaymentHistory(history, account.userId),
    reader.loadSupport(),
  ]);

  if ([subscription, offers, devices].some(
    (result) => result.status === "rejected"
      && isProviderSessionRecoveryRequired(result.reason),
  )) {
    return { status: "provider-session-recovery-required" };
  }

  return {
    status: "ready",
    user: account,
    subscription: subscription.status === "fulfilled" ? subscription.value : null,
    subscriptionError: subscription.status === "rejected" ? "Не удалось загрузить подписку." : null,
    offers: offers.status === "fulfilled" ? offers.value : null,
    devices: devices.status === "fulfilled" ? devices.value : null,
    payments: payments.status === "fulfilled" ? payments.value.records : [],
    paymentHistoryStatus: payments.status === "fulfilled"
      ? payments.value.status
      : "unavailable",
    support: support.status === "fulfilled"
      ? support.value
      : { enabled: false, email: null, telegramUsername: null, faqUrl: null },
  };
}
