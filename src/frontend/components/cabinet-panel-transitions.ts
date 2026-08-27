import type { CabinetViewModel } from "@/application/models/cabinet";
import type {
  DevicesResponse,
  SubscriptionOffersResponse,
} from "@/shared/domain/subscriptions";
import type {
  CabinetUser,
  CurrentSubscription,
  PaymentRecord,
  SupportSettings,
} from "@/frontend/components/cabinet-presentation";

export type CabinetPanelData = {
  user: CabinetUser | null;
  subscription: CurrentSubscription | null;
  offers: SubscriptionOffersResponse | null;
  devices: DevicesResponse | null;
  payments: PaymentRecord[];
  paymentHistoryStatus: "current" | "refreshing" | "unavailable";
  support: SupportSettings | null;
  error: string | null;
  subscriptionError: string | null;
};

export function selectCabinetPanelData(
  model: CabinetViewModel,
): CabinetPanelData {
  const initial = model.status === "ready" ? model : null;

  return {
    user: initial?.user ?? null,
    subscription: initial?.subscription ?? null,
    offers: initial?.offers ?? null,
    devices: initial?.devices ?? null,
    payments: initial?.payments ?? [],
    paymentHistoryStatus: initial?.paymentHistoryStatus ?? "current",
    support: initial?.support ?? null,
    error: model.status === "error" ? model.message : null,
    subscriptionError: initial?.subscriptionError ?? null,
  };
}

export function selectCabinetPanelPresentation({
  user,
  subscription,
  devices,
}: Pick<CabinetPanelData, "user" | "subscription" | "devices">) {
  const usedTraffic = subscription?.used_traffic_bytes ?? null;
  const trafficLimit = subscription?.traffic_limit ?? 0;
  const usagePercent =
    usedTraffic !== null && trafficLimit > 0
      ? Math.min(100, Math.round((usedTraffic / trafficLimit) * 100))
      : null;
  const deviceCount = devices?.current_count ?? null;
  const maxDevices = devices?.max_count ?? subscription?.device_limit ?? null;
  const hasEmail = Boolean(user?.email);
  const isEmailVerified =
    hasEmail && Boolean(user?.emailVerified ?? user?.is_email_verified);

  return {
    usedTraffic,
    usagePercent,
    deviceCount,
    maxDevices,
    hasEmail,
    isEmailVerified,
    shouldShowVerifyEmail: hasEmail && !isEmailVerified,
    shouldShowLinkAccount: !user?.email || !user?.telegramId,
  };
}

export function beginCabinetPendingAction(
  currentAction: string | null,
  requestedAction: string,
) {
  return currentAction
    ? { accepted: false as const, pendingAction: currentAction }
    : { accepted: true as const, pendingAction: requestedAction };
}

export function finishCabinetPendingAction(
  currentAction: string | null,
  completedAction: string,
) {
  return currentAction === completedAction ? null : currentAction;
}

export function canScheduleCabinetPaymentHistoryRefresh(
  completedAttempts: number,
) {
  return completedAttempts < 4;
}

export function normalizeCabinetPromocode(value: string) {
  return value.trim();
}

export function shouldRefreshCabinetAfterAction(status: string) {
  return status === "success";
}
