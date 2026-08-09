import type { NavigationReader } from "@/application/navigation/ports/navigation-reader";
import { remnashopSubscriptionReader } from "@/backend/integrations/remnashop/subscription-reader";
import type { createRemnashopSubscriptionReader } from "@/backend/integrations/remnashop/subscription-reader";

type SubscriptionReader = ReturnType<typeof createRemnashopSubscriptionReader>;

export function createProductionNavigationReader(
  subscriptions: SubscriptionReader = remnashopSubscriptionReader,
): NavigationReader {
  return { loadOffers: () => subscriptions.loadOffers() };
}

export const productionNavigationReader = createProductionNavigationReader();
