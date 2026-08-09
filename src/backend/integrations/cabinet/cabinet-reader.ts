import type { CabinetReader } from "@/application/cabinet/ports/cabinet-reader";
import { getEnv } from "@/backend/config/env";
import { remnashopSubscriptionReader } from "@/backend/integrations/remnashop/subscription-reader";

export const productionCabinetReader: CabinetReader = {
  loadSubscription: () => remnashopSubscriptionReader.loadCurrent(),
  loadOffers: () => remnashopSubscriptionReader.loadOffers(),
  loadDevices: () => remnashopSubscriptionReader.loadDevices(),
  async loadSupport() {
    return getEnv().support;
  },
};
