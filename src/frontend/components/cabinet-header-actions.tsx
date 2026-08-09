import { InstallAppButton } from "@/frontend/components/install-app-button";
import { LinkButton } from "@/frontend/components/prime/link-button";
import { hasRenewOffer } from "@/frontend/lib/subscription-offers";
import type { SubscriptionOffersResponse } from "@/shared/domain/subscriptions";

export function CabinetHeaderActions({ offers }: { offers: SubscriptionOffersResponse | null }) {
  const hasSubscription = Boolean(offers?.has_current_subscription);

  return (
    <>
      <InstallAppButton />
      <LinkButton href="/tariffs" label={hasSubscription ? "Изменить тариф" : "Тарифы"} outlined />
      {hasRenewOffer(offers) ? <LinkButton href="/extend" label="Продлить" /> : null}
    </>
  );
}
