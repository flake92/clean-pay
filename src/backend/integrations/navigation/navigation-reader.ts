import type { NavigationReader } from "@/application/navigation/ports/navigation-reader";
import { remnashopSubscriptionReader } from "@/backend/integrations/remnashop/subscription-reader";

export const productionNavigationReader: NavigationReader = {
  loadOffers: () => remnashopSubscriptionReader.loadOffers(),
};
