import type { SubscriptionOffersResponse } from "@/shared/domain/subscriptions";

export interface NavigationReader {
  loadOffers(): Promise<SubscriptionOffersResponse>;
}
