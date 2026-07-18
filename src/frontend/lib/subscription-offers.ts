import type { PlanOffer, SubscriptionOffersResponse } from "@/shared/remnashop/types";

export function getRecommendedPurchaseType(plan: PlanOffer) {
  return plan.recommended_purchase_type.toLowerCase();
}

export function findRenewPlan(offers: SubscriptionOffersResponse) {
  return offers.plans.find((plan) => getRecommendedPurchaseType(plan) === "renew");
}

export function hasRenewOffer(offers: SubscriptionOffersResponse | null | undefined) {
  return Boolean(offers && findRenewPlan(offers));
}
