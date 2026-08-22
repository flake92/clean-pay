import { Card } from "primereact/card";

import { loadProfileViewModel } from "@/application/profile/load-profile";
import { requestAuthProfileGateway } from "@/app/_composition/request-scoped-readers";
import { AppShell } from "@/app/_components/app-shell";
import { PageHeader } from "@/frontend/components/page-header";
import { ProfilePanel } from "@/frontend/components/profile-panel";
import { getBranding } from "@/shared/branding";
import { sessionRefreshPath } from "@/shared/auth/session-navigation";
import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

export default async function ProfilePage() {
  const branding = getBranding();
  const model = await loadProfileViewModel(requestAuthProfileGateway);
  if (model.status === "unauthorized") redirect(sessionRefreshPath("/profile"));
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
