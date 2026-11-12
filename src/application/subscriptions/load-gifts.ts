import type { GiftsViewModel } from "@/application/models/gifts";
import type { GiftReader } from "@/application/subscriptions/ports/gift-reader";
import type { SubscriptionCatalog } from "@/application/subscriptions/ports/subscription-catalog";
import { loadTariffsViewModel } from "@/application/subscriptions/load-tariffs";
import { giftPrice } from "@/shared/domain/payment-offer";
import type { SubscriptionOffersResponse } from "@/shared/domain/subscriptions";

/** Gifts are sold at the list price, so the catalog is shown without discounts. */
function giftOffers(offers: SubscriptionOffersResponse): SubscriptionOffersResponse {
  return {
    ...offers,
    plans: offers.plans.map((plan) => ({
      ...plan,
      durations: plan.durations.map((duration) => ({
        ...duration,
        prices: duration.prices.map(giftPrice).filter((price) => !price.is_free),
      })).filter((duration) => duration.prices.length > 0),
    })).filter((plan) => plan.durations.length > 0),
  };
}

export async function loadGiftsViewModel(
  catalog: SubscriptionCatalog,
  gifts: GiftReader,
): Promise<GiftsViewModel> {
  const tariffs = await loadTariffsViewModel(catalog);
  if (tariffs.status === "error") return tariffs;

  try {
    return {
      status: "ready",
      offers: giftOffers(tariffs.offers),
      gifts: (await gifts.loadGifts()).gifts,
      giftsError: null,
    };
  } catch {
    // The catalog still lets the user buy a gift; only the history is missing.
    return {
      status: "ready",
      offers: giftOffers(tariffs.offers),
      gifts: [],
      giftsError: "Не удалось загрузить купленные подарки. Обновите страницу позже.",
    };
  }
}
