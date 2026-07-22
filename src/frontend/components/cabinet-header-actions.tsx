"use client";

import { useEffect, useState } from "react";

import { InstallAppButton } from "@/frontend/components/install-app-button";
import { LinkButton } from "@/frontend/components/prime/link-button";
import { hasRenewOffer } from "@/frontend/lib/subscription-offers";
import type { SubscriptionOffersResponse } from "@/shared/remnashop/types";
import { getCachedBffJson } from "@/frontend/lib/bff-cache";

export function CabinetHeaderActions() {
  const [offers, setOffers] = useState<SubscriptionOffersResponse | null>(null);

  useEffect(() => {
    let alive = true;

    getCachedBffJson<SubscriptionOffersResponse>("/api/bff/subscription/offers")
      .then((response) => {
        if (alive) {
          setOffers(response.ok ? response.data : null);
        }
      })
      .catch(() => {
        if (alive) {
          setOffers(null);
        }
      });

    return () => {
      alive = false;
    };
  }, []);

  const hasSubscription = Boolean(offers?.has_current_subscription);

  return (
    <>
      <InstallAppButton />
      <LinkButton href="/tariffs" label={hasSubscription ? "Изменить тариф" : "Тарифы"} outlined />
      {hasRenewOffer(offers) ? <LinkButton href="/extend" label="Продлить" /> : null}
    </>
  );
}
