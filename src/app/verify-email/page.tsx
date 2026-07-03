import { Card } from "primereact/card";

import { AppShell, PageHeader } from "@/frontend/components/layout";
import { VerifyEmailPanel } from "@/frontend/components/verify-email-panel";

export const dynamic = "force-dynamic";

export default function VerifyEmailPage() {
  const turnstileEnabled = process.env.TURNSTILE_ENABLED === "true";
  const turnstileSiteKey = process.env.TURNSTILE_SITE_KEY;

  return (
    <AppShell>
      <div className="flex flex-column gap-6">
        <PageHeader
          description="Запросите код и подтвердите e-mail, чтобы разблокировать покупку."
          title="Подтверждение e-mail"
        />
        <Card>
          <VerifyEmailPanel turnstileEnabled={turnstileEnabled} turnstileSiteKey={turnstileSiteKey} />
        </Card>
      </div>
    </AppShell>
  );
}
