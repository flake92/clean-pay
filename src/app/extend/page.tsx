"use client";

import { Suspense } from "react";
import { Card } from "primereact/card";

import { ExtendConfirmation } from "@/frontend/components/extend-confirmation";
import { AppShell, PageHeader } from "@/frontend/components/layout";

export default function ExtendPage() {
  return (
    <AppShell>
      <div className="flex flex-column gap-6">
        <PageHeader
          description="Выберите доступное предложение продления и способ оплаты."
          title="Продление подписки"
        />
        <Card>
          <Suspense fallback={<p className="text-600">Загрузка...</p>}>
            <ExtendConfirmation />
          </Suspense>
        </Card>
      </div>
    </AppShell>
  );
}
