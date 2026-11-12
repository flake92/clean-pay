import type { TariffsViewModel } from "@/application/models/tariffs";
import type { Gift } from "@/shared/domain/gifts";
import type { SubscriptionOffersResponse } from "@/shared/domain/subscriptions";

export type GiftsViewModel =
  | {
      status: "ready";
      offers: SubscriptionOffersResponse;
      gifts: Gift[];
      giftsError: string | null;
    }
  | Extract<TariffsViewModel, { status: "error" }>;
