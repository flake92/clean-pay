import { beforeEach, describe, expect, it, vi } from "vitest";

import { assertPaymentReturnUrl, paymentReturnUrl } from "@/backend/payments/return-url";

describe("payment return URL contract", () => {
  beforeEach(() => {
    vi.stubEnv("APP_URL", "https://pay.example.com");
    vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://pay.example.com");
  });

  it("builds a server-owned pending URL bound to the operation", () => {
    expect(paymentReturnUrl("operation-1")).toBe(
      "https://pay.example.com/payment/pending?operation_id=operation-1",
    );
  });

  it("accepts an omitted legacy return URL but rejects a changed echoed URL", () => {
    const expected = paymentReturnUrl("operation-1");

    expect(() => assertPaymentReturnUrl(expected, expected)).not.toThrow();
    expect(() => assertPaymentReturnUrl(expected, null)).not.toThrow();
    expect(() => assertPaymentReturnUrl(expected, undefined)).not.toThrow();
    expect(() => assertPaymentReturnUrl(expected, "https://attacker.example/payment/success"))
      .toThrowError(expect.objectContaining({ code: "UPSTREAM_ERROR", status: 502 }));
  });
});
