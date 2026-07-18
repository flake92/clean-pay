import { getEnv } from "@/backend/config/env";
import { BffError } from "@/backend/integrations/remnashop/errors";

export function paymentReturnUrl(operationId: string) {
  const url = new URL(getEnv().paymentReturnUrls.pending);
  url.searchParams.set("operation_id", operationId);

  return url.toString();
}

export function assertPaymentReturnUrl(expected: string, actual: unknown) {
  if (actual !== expected) {
    throw new BffError(
      "UPSTREAM_ERROR",
      502,
      "Remnashop did not confirm the requested payment return URL",
      { message: "Payment return URL contract mismatch" },
    );
  }
}
