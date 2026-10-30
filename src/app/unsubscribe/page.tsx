import type { Metadata } from "next";

import { AuthShell } from "@/frontend/components/auth-shell";
import { UnsubscribePanel } from "@/frontend/components/unsubscribe-panel";

export const metadata: Metadata = {
  title: "Отписка от писем",
  robots: { index: false, follow: false },
};

export default async function UnsubscribePage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string | string[] }>;
}) {
  const { token } = await searchParams;

  return (
    <AuthShell
      title="Отписка от писем"
      description="Подтвердите, что больше не хотите получать эти письма."
    >
      <UnsubscribePanel token={typeof token === "string" ? token : ""} />
    </AuthShell>
  );
}
