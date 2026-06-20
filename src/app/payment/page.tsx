"use client";

import { Suspense } from "react";
import { Card } from "primereact/card";

import { AppShell, PageHeader } from "@/components/layout";
import { PaymentConfirmation } from "@/components/payment-confirmation";

export default function PaymentPage() {
  return (
    <AppShell>
      <div className="grid max-w-3xl gap-6">
        <PageHeader
          description="Проверьте выбранный тариф перед переходом к платёжной странице."
          title="Подтверждение оплаты"
        />
        <Card>
          <Suspense fallback={<p className="text-600">Загрузка...</p>}>
            <PaymentConfirmation />
          </Suspense>
        </Card>
      </div>
    </AppShell>
  );
}
