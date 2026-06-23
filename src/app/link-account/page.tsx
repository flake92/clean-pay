import { Card } from "primereact/card";

import { AppShell, PageHeader } from "@/components/layout";
import { LinkAccountPanel } from "@/components/link-account-panel";

export const dynamic = "force-dynamic";

export default function LinkAccountPage() {
  const turnstileEnabled = process.env.TURNSTILE_ENABLED === "true";

  return (
    <AppShell>
      <div className="flex flex-column gap-6">
        <PageHeader
          description="Свяжите e-mail и Telegram-профиль, чтобы сохранить доступ из обоих сценариев."
          title="Привязка аккаунта"
        />
        <Card>
          <LinkAccountPanel turnstileEnabled={turnstileEnabled} />
        </Card>
      </div>
    </AppShell>
  );
}
