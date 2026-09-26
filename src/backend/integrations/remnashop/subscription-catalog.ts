import {
  SubscriptionCatalogAccessError,
  type SubscriptionCatalog,
} from "@/application/subscriptions/ports/subscription-catalog";
import { remnashopValidatedRequest } from "@/backend/integrations/remnashop/api-client-runtime";
import type { getAuthorizedRemnashopTokens } from "@/backend/integrations/remnashop/client";
import { ServiceError } from "@/backend/errors/service-error";
import type { SubscriptionOffersResponse } from "@/backend/integrations/remnashop/contracts";

type Authorized = Awaited<ReturnType<typeof getAuthorizedRemnashopTokens>>;

export function createRemnashopSubscriptionCatalog(
  authorize: () => Promise<Authorized>,
): SubscriptionCatalog {
  return {
    async loadOffers() {
      try {
        const { accessToken } = await authorize();
        return await remnashopValidatedRequest<SubscriptionOffersResponse>("/subscription/offers", { accessToken });
      } catch (error) {
        if (error instanceof ServiceError) {
          if (error.code === "PROVIDER_SESSION_RECOVERY_REQUIRED") {
            throw new SubscriptionCatalogAccessError("provider-session-recovery-required");
          }
          if (error.status === 401) throw new SubscriptionCatalogAccessError("unauthorized");
          if (error.code === "EMAIL_REQUIRED" || error.code === "EMAIL_NOT_VERIFIED") {
            throw new SubscriptionCatalogAccessError("email-required");
          }
        }
        throw new SubscriptionCatalogAccessError("unavailable");
      }
    },
  };
}
