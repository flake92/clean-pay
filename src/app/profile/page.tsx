import { Card } from "primereact/card";

import { loadProfileViewModel } from "@/application/profile/load-profile";
import { productionAuthProfileGateway } from "@/backend/integrations/auth/auth-profile-gateway";
import { AppShell } from "@/app/_components/app-shell";
import { PageHeader } from "@/frontend/components/layout";
import { ProfilePanel } from "@/frontend/components/profile-panel";
import { getBranding } from "@/shared/branding";
import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

export default async function ProfilePage() {
  const branding = getBranding();
  const model = await loadProfileViewModel(productionAuthProfileGateway);
  if (model.status === "unauthorized") redirect("/login");
  const turnstileEnabled = process.env.TURNSTILE_ENABLED === "true";
  const turnstileSiteKey = process.env.TURNSTILE_SITE_KEY;

  return (
    <AppShell requireAuth>
      <div className="flex flex-column gap-6">
        <PageHeader
          description={`Данные аккаунта, e-mail и пароль управляются через ${branding.name}.`}
          title="Профиль"
        />
        <Card>
          <ProfilePanel model={model} turnstileEnabled={turnstileEnabled} turnstileSiteKey={turnstileSiteKey} />
        </Card>
      </div>
    </AppShell>
  );
}
