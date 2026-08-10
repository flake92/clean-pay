import { PaymentStatusPage } from "@/app/payment/payment-status-page";

export default function PaymentFailPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  return <PaymentStatusPage kind="fail" searchParams={searchParams} />;
}
