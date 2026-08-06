import type { SubscriptionReader } from "@/backend/application/subscriptions/ports/subscription-reader";
import { getAuthorizedRemnashopTokens, remnashopRequest } from "@/backend/integrations/remnashop/client";
import { ServiceError } from "@/backend/errors/service-error";
import { getLiveRemnawaveSubscriptionUrl } from "@/backend/integrations/remnawave/client";
import type {
  CurrentSubscriptionResponse,
  DevicesResponse,
  SubscriptionOffersResponse,
} from "@/shared/remnashop/types";

async function loadCurrentSubscription() {
  const { accessToken, session } = await getAuthorizedRemnashopTokens();
  const subscription = await remnashopRequest<CurrentSubscriptionResponse | null>(
    "/subscription/current",
    { accessToken },
  );

  if (!subscription) return null;

  const liveUrl = await getLiveRemnawaveSubscriptionUrl({
    userRemnaId: subscription.user_remna_id,
    email: session.user.email,
    telegramId: session.user.telegramId,
  });
  if (!liveUrl) {
    throw new ServiceError(
      "SUBSCRIPTION_URL_UNAVAILABLE",
      409,
      "Remnawave did not provide an available subscription URL",
      { upstreamPath: "/api/users" },
    );
  }
  return { ...subscription, url: liveUrl };
}

async function loadSubscriptionDevices() {
  const { accessToken } = await getAuthorizedRemnashopTokens();
  return remnashopRequest<DevicesResponse>("/subscription/devices", { accessToken });
}

async function loadSubscriptionOffers() {
  const { accessToken } = await getAuthorizedRemnashopTokens();
  return remnashopRequest<SubscriptionOffersResponse>("/subscription/offers", { accessToken });
}

export const remnashopSubscriptionReader: SubscriptionReader = {
  loadCurrent: loadCurrentSubscription,
  loadDevices: loadSubscriptionDevices,
  loadOffers: loadSubscriptionOffers,
};
