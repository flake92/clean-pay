/** @vitest-environment jsdom */

import { beforeEach, describe, expect, it } from "vitest";

import {
  readPaymentReturnReference,
  storePaymentReturnReference,
} from "@/frontend/lib/payment-return-storage";

describe("payment return reference storage", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it("replaces an operation reference with one payment reference atomically", () => {
    expect(storePaymentReturnReference({ operationId: "operation-1" })).toBe(true);
    expect(readPaymentReturnReference()).toEqual({ operationId: "operation-1" });

    expect(storePaymentReturnReference({ paymentId: "payment-2" })).toBe(true);
    expect(readPaymentReturnReference()).toEqual({ paymentId: "payment-2" });
  });

  it("never combines legacy identifiers from different payment attempts", () => {
    window.localStorage.setItem("cleanPayLastPaymentId", "payment-old");
    window.localStorage.setItem(
      "cleanPayLastPaymentOperationId",
      "operation-new",
    );

    expect(readPaymentReturnReference()).toEqual({ operationId: "operation-new" });
  });

  it("rejects a malformed versioned pair instead of mixing its identifiers", () => {
    window.localStorage.setItem(
      "cleanPayLastPaymentReference:v1",
      JSON.stringify({ paymentId: "payment-a", operationId: "operation-b" }),
    );

    expect(readPaymentReturnReference()).toBeNull();
  });
});
