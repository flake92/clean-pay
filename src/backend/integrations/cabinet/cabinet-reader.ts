import type { CabinetReader } from "@/application/cabinet/ports/cabinet-reader";
import { getEnv } from "@/backend/config/env";
import { remnashopSubscriptionReader } from "@/backend/integrations/remnashop/subscription-reader";
import type { createRemnashopSubscriptionReader } from "@/backend/integrations/remnashop/subscription-reader";

type SubscriptionReader = ReturnType<typeof createRemnashopSubscriptionReader>;

export function createProductionCabinetReader(
  subscriptions: SubscriptionReader = remnashopSubscriptionReader,
): CabinetReader {
  return {
    loadSubscription: () => subscriptions.loadCurrent(),
    loadOffers: () => subscriptions.loadOffers(),
    loadDevices: () => subscriptions.loadDevices(),
    async loadSupport() {
      return getEnv().support;
    },
  };
}
