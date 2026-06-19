import { Suspense } from "react";

import { PaymentReturnStatus } from "@/components/payment-return-status";

export default function PaymentPendingPage() {
  return (
    <Suspense fallback={<p className="p-6 text-zinc-600">Загрузка...</p>}>
      <PaymentReturnStatus kind="pending" />
    </Suspense>
  );
}
