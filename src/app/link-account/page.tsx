"use client";

import { Card } from "primereact/card";

import { AppShell, PageHeader } from "@/components/layout";
import { LinkAccountPanel } from "@/components/link-account-panel";

export default function LinkAccountPage() {
  return (
    <AppShell>
      <div className="flex flex-column gap-6">
        <PageHeader
          description="Свяжите e-mail и Telegram-профиль, чтобы сохранить доступ из обоих сценариев."
          title="Привязка аккаунта"
        />
        <Card>
          <LinkAccountPanel />
        </Card>
      </div>
    </AppShell>
  );
}
