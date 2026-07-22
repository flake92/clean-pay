import { describe, expect, it } from "vitest";

import {
  paymentPollDelayMs,
  paymentReturnOutcome,
  shouldPollPaymentReturn,
} from "@/frontend/lib/payment-return";

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
