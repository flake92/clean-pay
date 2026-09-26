import type { CabinetReader } from "@/application/cabinet/ports/cabinet-reader";
import { getEnv } from "@/backend/config/env";
import type { createRemnashopSubscriptionReader } from "@/backend/integrations/remnashop/subscription-reader";

type SubscriptionReader = ReturnType<typeof createRemnashopSubscriptionReader>;

export function createProductionCabinetReader(
  subscriptions: SubscriptionReader,
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
