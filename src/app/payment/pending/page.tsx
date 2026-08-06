import { PaymentStatusPage } from "@/app/payment/payment-status-page";

export default function PaymentPendingPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  return <PaymentStatusPage kind="pending" searchParams={searchParams} />;
}
