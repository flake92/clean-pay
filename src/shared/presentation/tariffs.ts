import type { SubscriptionOffersResponse } from "@/shared/remnashop/types";

export type TariffsViewModel =
  | { status: "ready"; offers: SubscriptionOffersResponse }
  | { status: "error"; message: string; action?: "login" | "linkEmail" };
