import type { TariffsViewModel } from "@/application/models/tariffs";
import type { Gift, ReceivedGift } from "@/shared/domain/gifts";
import type { SubscriptionOffersResponse } from "@/shared/domain/subscriptions";

export type GiftsViewModel =
  | {
      status: "ready";
      offers: SubscriptionOffersResponse;
      gifts: Gift[];
      received: ReceivedGift[];
      giftsError: string | null;
    }
  | Extract<TariffsViewModel, { status: "error" }>;
