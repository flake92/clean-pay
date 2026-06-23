"use client";

import { Card } from "primereact/card";

import { AppShell, PageHeader } from "@/components/layout";
import { ProfilePanel } from "@/components/profile-panel";

export default function ProfilePage() {
  return (
    <AppShell>
      <div className="flex flex-column gap-6">
        <PageHeader
          description="Данные аккаунта, e-mail и пароль управляются через CleanVPN."
          title="Профиль"
        />
        <Card>
          <ProfilePanel />
        </Card>
      </div>
    </AppShell>
  );
}
