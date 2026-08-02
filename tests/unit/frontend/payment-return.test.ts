import { describe, expect, it } from "vitest";

import {
  paymentPollDelayMs,
  paymentReturnOutcome,
  shouldPollPaymentReturn,
  shouldRetryPaymentReturnError,
} from "@/frontend/lib/payment-return";
import { BffClientError } from "@/frontend/lib/client-api";

describe("payment return state", () => {
  it("derives the page outcome only from server-authoritative state", () => {
    expect(paymentReturnOutcome(null)).toBe("checking");
    expect(paymentReturnOutcome({ payment: { status: "completed" } })).toBe("success");
    expect(paymentReturnOutcome({ operation: { status: "succeeded" } })).toBe("success");
    expect(paymentReturnOutcome({
      operation: { status: "succeeded" },
      payment: { status: "pending" },
    })).toBe("pending");
    expect(paymentReturnOutcome({ payment: { status: "canceled" } })).toBe("failed");
    expect(paymentReturnOutcome({ operation: { status: "manual_required" } })).toBe("unknown");
    expect(paymentReturnOutcome({ operation: { status: "processing" } })).toBe("pending");
  });

  it("polls pending payments and unknown operations with bounded backoff", () => {
    expect(shouldPollPaymentReturn({ payment: { status: "pending" } })).toBe(true);
    expect(shouldPollPaymentReturn({ operation: { status: "outcome_unknown" } })).toBe(true);
    expect(shouldPollPaymentReturn({ payment: { status: "completed" } })).toBe(false);
    expect(paymentPollDelayMs(0)).toBe(2_000);
    expect(paymentPollDelayMs(4)).toBe(30_000);
    expect(paymentPollDelayMs(20)).toBe(30_000);
    expect(paymentPollDelayMs(0, 9)).toBe(9_000);
  });

  it("stops polling when the operation is terminal even if its payment is pending", () => {
    for (const status of ["failed", "manual_required", "retry_ready"]) {
      expect(shouldPollPaymentReturn({
        operation: { status },
        payment: { status: "pending" },
      })).toBe(false);
    }

    expect(shouldPollPaymentReturn({
      operation: { status: "succeeded" },
      payment: { status: "pending" },
    })).toBe(true);
  });

  it("retries only transient HTTP and actual network failures", () => {
    for (const status of [408, 429, 500, 503]) {
      expect(shouldRetryPaymentReturnError(
        new BffClientError("transient", status),
      )).toBe(true);
    }

    for (const status of [400, 401, 403, 404, 409, 422]) {
      expect(shouldRetryPaymentReturnError(
        new BffClientError("permanent", status),
      )).toBe(false);
    }

    expect(shouldRetryPaymentReturnError(new TypeError("Failed to fetch")))
      .toBe(true);
    expect(shouldRetryPaymentReturnError(new Error("Invalid response contract")))
      .toBe(false);
  });

  it("documents why identifiers from separate attempts must never be mixed", () => {
    const processingWithStalePayment = {
      operation: { status: "processing" },
      payment: { status: "completed" },
    };
    const retryReadyWithStalePayment = {
      operation: { status: "retry_ready" },
      payment: { status: "completed" },
    };

    // The UI would otherwise show success for both mixed snapshots. Processing
    // still polls, while retry_ready is terminal until the user retries.
    expect(paymentReturnOutcome(processingWithStalePayment)).toBe("success");
    expect(shouldPollPaymentReturn(processingWithStalePayment)).toBe(true);
    expect(paymentReturnOutcome(retryReadyWithStalePayment)).toBe("success");
    expect(shouldPollPaymentReturn(retryReadyWithStalePayment)).toBe(false);
  });
});
