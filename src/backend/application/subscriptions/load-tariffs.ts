import {
  SubscriptionCatalogAccessError,
  type SubscriptionCatalog,
} from "@/backend/application/subscriptions/ports/subscription-catalog";
import type { TariffsViewModel } from "@/shared/presentation/tariffs";

export async function loadTariffsViewModel(catalog: SubscriptionCatalog): Promise<TariffsViewModel> {
  try {
    return { status: "ready", offers: await catalog.loadOffers() };
  } catch (error) {
    if (error instanceof SubscriptionCatalogAccessError) {
      if (error.reason === "unauthorized") {
        return { status: "error", message: "Нужно войти в аккаунт.", action: "login" };
      }
      if (error.reason === "email-required") {
        return { status: "error", message: "Для просмотра тарифов подтвердите e-mail.", action: "linkEmail" };
      }
    }
    return { status: "error", message: "Не удалось загрузить тарифы." };
  }
}
