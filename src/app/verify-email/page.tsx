import { Card } from "primereact/card";

import { AppShell, PageHeader } from "@/components/layout";
import { VerifyEmailPanel } from "@/components/verify-email-panel";

export const dynamic = "force-dynamic";

export default function VerifyEmailPage() {
  const turnstileEnabled = process.env.TURNSTILE_ENABLED === "true";

  return (
    <AppShell>
      <div className="flex flex-column gap-6">
        <PageHeader
          description="Запросите код и подтвердите e-mail, чтобы разблокировать покупку."
          title="Подтверждение e-mail"
        />
        <Card>
          <VerifyEmailPanel turnstileEnabled={turnstileEnabled} />
        </Card>
      </div>
    </AppShell>
  );
}
