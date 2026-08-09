import type { CabinetReader } from "@/application/cabinet/ports/cabinet-reader";
import { getCurrentAuthProfile } from "@/backend/auth/profile";
import { getEnv } from "@/backend/config/env";
import { loadPaymentHistory } from "@/backend/integrations/payments/payment-history-reader";
import { remnashopSubscriptionReader } from "@/backend/integrations/remnashop/subscription-reader";
import { getCurrentUser } from "@/backend/integrations/sessions/web-session-service";

export const productionCabinetReader: CabinetReader = {
  async loadUser() {
    const user = await getCurrentUser();
    if (!user) throw new Error("unauthorized");
    const profile = await getCurrentAuthProfile();
    return { id: user.id, profile: profile.user };
  },
  loadSubscription: () => remnashopSubscriptionReader.loadCurrent(),
  loadOffers: () => remnashopSubscriptionReader.loadOffers(),
  loadDevices: () => remnashopSubscriptionReader.loadDevices(),
  loadPayments: loadPaymentHistory,
  async loadSupport() {
    return getEnv().support;
  },
};
