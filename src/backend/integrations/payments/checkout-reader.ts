import type { CheckoutReader } from "@/application/payments/ports/checkout";
import {
  remnashopSubscriptionReader,
  type createRemnashopSubscriptionReader,
} from "@/backend/integrations/remnashop/subscription-reader";

type SubscriptionReader = ReturnType<typeof createRemnashopSubscriptionReader>;

export function createProductionCheckoutReader(
  subscriptions: SubscriptionReader = remnashopSubscriptionReader,
): CheckoutReader {
  return {
    loadOffers: () => subscriptions.loadOffers(),
  };
}

export const productionCheckoutReader = createProductionCheckoutReader();
