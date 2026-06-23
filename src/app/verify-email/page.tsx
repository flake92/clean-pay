"use client";

import { Card } from "primereact/card";

import { AppShell, PageHeader } from "@/components/layout";
import { VerifyEmailPanel } from "@/components/verify-email-panel";

export default function VerifyEmailPage() {
  return (
    <AppShell>
      <div className="flex flex-column gap-6">
        <PageHeader
          description="Запросите код и подтвердите e-mail, чтобы разблокировать покупку."
          title="Подтверждение e-mail"
        />
        <Card>
          <VerifyEmailPanel />
        </Card>
      </div>
    </AppShell>
  );
}
