import type { SubscriptionOffersResponse } from "@/shared/domain/subscriptions";

export interface SubscriptionCatalog {
  loadOffers(): Promise<SubscriptionOffersResponse>;
}

export class SubscriptionCatalogAccessError extends Error {
  constructor(public readonly reason: "unauthorized" | "email-required" | "unavailable") {
    super(reason);
  }
}
