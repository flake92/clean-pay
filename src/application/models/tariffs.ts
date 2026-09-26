import type { SubscriptionOffersResponse } from "@/shared/domain/subscriptions";

export type TariffsViewModel =
  | { status: "ready"; offers: SubscriptionOffersResponse }
  | { status: "error"; message: string; action?: "login" | "recover-session" | "linkEmail" };
