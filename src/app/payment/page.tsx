import { Suspense } from "react";

import { PaymentConfirmation } from "@/components/payment-confirmation";

export default function PaymentPage() {
  return (
    <main className="mx-auto min-h-screen w-full max-w-3xl px-6 py-16">
      <p className="text-sm font-medium uppercase tracking-[0.18em] text-cyan-700">
        CleanVPN
      </p>
      <h1 className="mt-4 text-3xl font-semibold">Подтверждение оплаты</h1>
      <section className="mt-8">
        <Suspense fallback={<p className="text-zinc-600">Загрузка...</p>}>
          <PaymentConfirmation />
        </Suspense>
      </section>
    </main>
  );
}
