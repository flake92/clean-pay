import type { CheckoutReader } from "@/application/payments/ports/checkout";
import { remnashopSubscriptionReader } from "@/backend/integrations/remnashop/subscription-reader";

export const productionCheckoutReader: CheckoutReader = {
  loadOffers: () => remnashopSubscriptionReader.loadOffers(),
};
