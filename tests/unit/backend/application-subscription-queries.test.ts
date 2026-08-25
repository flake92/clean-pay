import { describe, expect, it } from "vitest";

import { loadTariffsViewModel } from "@/application/subscriptions/load-tariffs";
import {
  SubscriptionCatalogAccessError,
  type SubscriptionCatalog,
} from "@/application/subscriptions/ports/subscription-catalog";

const offers = {
  gateways: [],
  plans: [],
  has_current_subscription: false,
  current_subscription_status: null,
};

describe("loadTariffsViewModel", () => {
  it("returns an explicit ready view model from the catalog port", async () => {
    const catalog: SubscriptionCatalog = { loadOffers: async () => offers };

    await expect(loadTariffsViewModel(catalog)).resolves.toEqual({ status: "ready", offers });
  });

  it.each([
    ["unauthorized", "login"],
    ["provider-session-recovery-required", "recover-session"],
    ["email-required", "linkEmail"],
  ] as const)("maps %s without leaking adapter errors", async (reason, action) => {
    const catalog: SubscriptionCatalog = {
      loadOffers: async () => { throw new SubscriptionCatalogAccessError(reason); },
    };

    await expect(loadTariffsViewModel(catalog)).resolves.toMatchObject({ status: "error", action });
  });

  it("hides unexpected catalog failures behind the generic view model", async () => {
    const catalog: SubscriptionCatalog = {
      loadOffers: async () => { throw new TypeError("private adapter detail"); },
    };
    await expect(loadTariffsViewModel(catalog)).resolves.toEqual({
      status: "error", message: "Не удалось загрузить тарифы.",
    });
  });
});
