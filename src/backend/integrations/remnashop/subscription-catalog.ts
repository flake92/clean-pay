import {
  SubscriptionCatalogAccessError,
  type SubscriptionCatalog,
} from "@/backend/application/subscriptions/ports/subscription-catalog";
import { getAuthorizedRemnashopTokens, remnashopRequest } from "@/backend/integrations/remnashop/client";
import { ServiceError } from "@/backend/errors/service-error";
import type { SubscriptionOffersResponse } from "@/shared/remnashop/types";

export const remnashopSubscriptionCatalog: SubscriptionCatalog = {
  async loadOffers() {
    try {
      const { accessToken } = await getAuthorizedRemnashopTokens();
      return await remnashopRequest<SubscriptionOffersResponse>("/subscription/offers", { accessToken });
    } catch (error) {
      if (error instanceof ServiceError) {
        if (error.status === 401) throw new SubscriptionCatalogAccessError("unauthorized");
        if (error.code === "EMAIL_REQUIRED" || error.code === "EMAIL_NOT_VERIFIED") {
          throw new SubscriptionCatalogAccessError("email-required");
        }
      }
      throw new SubscriptionCatalogAccessError("unavailable");
    }
  },
};
