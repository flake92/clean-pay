"use client";

import { Card } from "primereact/card";

import { AppShell, PageHeader } from "@/components/layout";
import { ProfilePanel } from "@/components/profile-panel";

export default function ProfilePage() {
  return (
    <AppShell>
      <div className="grid max-w-3xl gap-6">
        <PageHeader
          description="Данные аккаунта, e-mail и пароль управляются через Remnashop API."
          title="Профиль"
        />
        <Card>
          <ProfilePanel />
        </Card>
      </div>
    </AppShell>
  );
}
