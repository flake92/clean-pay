import { Card } from "primereact/card";

import { AppShell, PageHeader } from "@/frontend/components/layout";
import { ProfilePanel } from "@/frontend/components/profile-panel";
import { getBranding } from "@/shared/branding";

export const dynamic = "force-dynamic";

export default function ProfilePage() {
  const branding = getBranding();
  const turnstileEnabled = process.env.TURNSTILE_ENABLED === "true";
  const turnstileSiteKey = process.env.TURNSTILE_SITE_KEY;

  return (
    <AppShell>
      <div className="flex flex-column gap-6">
        <PageHeader
          description={`Данные аккаунта, e-mail и пароль управляются через ${branding.name}.`}
          title="Профиль"
        />
        <Card>
          <ProfilePanel turnstileEnabled={turnstileEnabled} turnstileSiteKey={turnstileSiteKey} />
        </Card>
      </div>
    </AppShell>
  );
}
