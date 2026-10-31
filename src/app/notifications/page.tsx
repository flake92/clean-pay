import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { AppShell } from "@/app/_components/app-shell";
import { productionNotificationFeedGateway } from "@/app/_composition/session-gateways";
import { loadNotificationFeed } from "@/application/notifications/notification-feed";
import { NotificationFeed } from "@/frontend/components/notification-feed";
import { PageHeader } from "@/frontend/components/page-header";
import { sessionRefreshPath } from "@/shared/auth/session-navigation";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Уведомления",
  robots: { index: false, follow: false },
};

export default async function NotificationsPage({
  searchParams,
}: {
  searchParams: Promise<{ item?: string | string[] }>;
}) {
  const { item } = await searchParams;
  const feed = await loadNotificationFeed(productionNotificationFeedGateway);
  if (!feed.ok && feed.code === "UNAUTHORIZED") redirect(sessionRefreshPath("/notifications"));

  return (
    <AppShell requireAuth returnTo="/notifications">
      <div className="flex flex-column gap-4">
        <PageHeader
          description="Все сообщения бота: служебные и новости."
          title="Уведомления"
        />
        <NotificationFeed
          focusItem={typeof item === "string" ? Number(item) : null}
          initialPage={feed.ok ? feed.page : null}
        />
      </div>
    </AppShell>
  );
}
