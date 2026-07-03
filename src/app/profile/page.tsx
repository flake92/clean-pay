"use client";

import { Card } from "primereact/card";

import { AppShell, PageHeader } from "@/frontend/components/layout";
import { ProfilePanel } from "@/frontend/components/profile-panel";
import { getBranding } from "@/shared/branding";

export default function ProfilePage() {
  const branding = getBranding();

  return (
    <AppShell>
      <div className="flex flex-column gap-6">
        <PageHeader
          description={`Данные аккаунта, e-mail и пароль управляются через ${branding.name}.`}
          title="РџСЂРѕС„РёР»СЊ"
        />
        <Card>
          <ProfilePanel />
        </Card>
      </div>
    </AppShell>
  );
}
