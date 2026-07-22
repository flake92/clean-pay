import { Suspense } from "react";

import { PaymentReturnStatus } from "@/frontend/components/payment-return-status";

export default function PaymentPendingPage() {
  return (
    <Suspense fallback={<p className="p-6 text-600">Загрузка...</p>}>
      <PaymentReturnStatus kind="pending" />
    </Suspense>
  );
}
