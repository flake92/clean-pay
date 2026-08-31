import type { CheckoutReader } from "@/application/payments/ports/checkout";
import type { createRemnashopSubscriptionReader } from "@/backend/integrations/remnashop/subscription-reader";

type SubscriptionReader = ReturnType<typeof createRemnashopSubscriptionReader>;

export function createProductionCheckoutReader(
  subscriptions: SubscriptionReader,
): CheckoutReader {
  return {
    loadOffers: () => subscriptions.loadOffers(),
  };
}
