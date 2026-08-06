import { getEnv } from "@/backend/config/env";
import { ServiceError } from "@/backend/errors/service-error";

export function paymentReturnUrl(operationId: string) {
  const url = new URL(getEnv().paymentReturnUrls.pending);
  url.searchParams.set("operation_id", operationId);

  return url.toString();
}

export function assertPaymentReturnUrl(expected: string, actual: unknown) {
  // Older Remnashop releases accept the optional return_url request field but
  // omit it from PaymentInitResponse. In that contract there is nothing to
  // compare; the provider payment URL is still server-created and trusted.
  // Newer releases echo the value, and any echoed mismatch remains fatal.
  if (actual === null || actual === undefined) {
    return;
  }

  if (actual !== expected) {
    throw new ServiceError(
      "UPSTREAM_ERROR",
      502,
      "Remnashop did not confirm the requested payment return URL",
      { message: "Payment return URL contract mismatch" },
    );
  }
}
