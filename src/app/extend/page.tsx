"use client";

import { Card } from "primereact/card";

import { ExtendConfirmation } from "@/components/extend-confirmation";
import { AppShell, PageHeader } from "@/components/layout";

export default function ExtendPage() {
  return (
    <AppShell>
      <div className="grid max-w-3xl gap-6">
        <PageHeader
          description="Выберите доступное предложение продления и способ оплаты."
          title="Продление подписки"
        />
        <Card>
          <ExtendConfirmation />
        </Card>
      </div>
    </AppShell>
  );
}
