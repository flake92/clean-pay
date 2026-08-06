import { PaymentStatusPage } from "@/app/payment/payment-status-page";

export default function PaymentSuccessPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  return <PaymentStatusPage kind="success" searchParams={searchParams} />;
}
