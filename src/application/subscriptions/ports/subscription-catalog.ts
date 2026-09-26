import type { SubscriptionOffersResponse } from "@/shared/domain/subscriptions";

export interface SubscriptionCatalog {
  loadOffers(): Promise<SubscriptionOffersResponse>;
}

export class SubscriptionCatalogAccessError extends Error {
  constructor(public readonly reason: "unauthorized" | "provider-session-recovery-required" | "email-required" | "unavailable") {
    super(reason);
  }
}
