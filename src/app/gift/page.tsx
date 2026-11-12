import { AppShell } from "@/app/_components/app-shell";
import { GiftPanel } from "@/frontend/components/gift-panel";
import { PageHeader } from "@/frontend/components/page-header";
import { loadGiftsViewModel } from "@/application/subscriptions/load-gifts";
import {
  requestGiftReader,
  requestSubscriptionCatalog,
} from "@/app/_composition/request-scoped-readers";
import { providerSessionRecoveryPath } from "@/shared/auth/session-navigation";
import { redirect } from "next/navigation";

export default async function GiftPage() {
  const model = await loadGiftsViewModel(requestSubscriptionCatalog, requestGiftReader);
  if (model.status === "error" && model.action === "recover-session") {
    redirect(providerSessionRecoveryPath("/gift"));
  }

  return (
    <AppShell requireAuth returnTo="/gift">
      <div className="flex flex-column gap-6">
        <PageHeader
          description="Оплатите подписку для друга или близкого: после оплаты вы получите код, который он активирует в своём личном кабинете."
          title="Подписка в подарок"
        />
        <GiftPanel model={model} />
      </div>
    </AppShell>
  );
}
