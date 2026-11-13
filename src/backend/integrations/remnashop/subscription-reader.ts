import { remnashopValidatedRequest } from "@/backend/integrations/remnashop/api-client-runtime";
import type { getAuthorizedRemnashopTokens } from "@/backend/integrations/remnashop/client";
import { ServiceError } from "@/backend/errors/service-error";
import { getLiveRemnawaveSubscriptionUrl } from "@/backend/integrations/remnawave/client";
import type {
  CurrentSubscriptionResponse,
  DevicesResponse,
  SubscriptionOffersResponse,
} from "@/backend/integrations/remnashop/contracts";
import type { GiftsResponse } from "@/shared/domain/gifts";
import type { ChangeQuote } from "@/shared/domain/plan-change";

type Authorized = Awaited<ReturnType<typeof getAuthorizedRemnashopTokens>>;
type SubscriptionAuthorizer = () => Promise<Authorized>;

async function loadCurrentSubscription(authorize: SubscriptionAuthorizer) {
  const { accessToken, session } = await authorize();
  const subscription = await remnashopValidatedRequest<CurrentSubscriptionResponse | null>(
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

async function loadSubscriptionDevices(authorize: SubscriptionAuthorizer) {
  const { accessToken } = await authorize();
  return remnashopValidatedRequest<DevicesResponse>("/subscription/devices", { accessToken });
}

async function loadSubscriptionOffers(authorize: SubscriptionAuthorizer) {
  const { accessToken } = await authorize();
  return remnashopValidatedRequest<SubscriptionOffersResponse>("/subscription/offers", { accessToken });
}

async function loadBoughtGifts(authorize: SubscriptionAuthorizer) {
  const { accessToken } = await authorize();
  return remnashopValidatedRequest<GiftsResponse>("/subscription/gifts", { accessToken });
}

async function loadPlanChangeQuote(
  authorize: SubscriptionAuthorizer,
  planCode: string,
  durationDays: number,
) {
  const { accessToken } = await authorize();
  const params = new URLSearchParams({ plan_code: planCode, duration_days: String(durationDays) });
  return remnashopValidatedRequest<ChangeQuote>(`/subscription/change-quote?${params}`, { accessToken });
}

export function createRemnashopSubscriptionReader(
  authorize: SubscriptionAuthorizer,
) {
  return {
    loadCurrent: () => loadCurrentSubscription(authorize),
    loadDevices: () => loadSubscriptionDevices(authorize),
    loadOffers: () => loadSubscriptionOffers(authorize),
    loadGifts: () => loadBoughtGifts(authorize),
    loadChangeQuote: (planCode: string, durationDays: number) =>
      loadPlanChangeQuote(authorize, planCode, durationDays),
  };
}
