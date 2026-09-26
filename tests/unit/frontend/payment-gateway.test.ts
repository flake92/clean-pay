import { describe, expect, it } from "vitest";

import { paymentGatewayLabel } from "@/frontend/lib/payment-gateway";

describe("payment gateway presentation", () => {
  it("uses the Remnashop user-facing names and preserves unknown identifiers", () => {
    expect(paymentGatewayLabel("YOOKASSA")).toBe("ЮKassa");
    expect(paymentGatewayLabel("TELEGRAM_STARS")).toBe("Telegram Stars");
    expect(paymentGatewayLabel("CUSTOM_GATEWAY")).toBe("CUSTOM_GATEWAY");
    expect(paymentGatewayLabel(" YOOKASSA ")).toBe(" YOOKASSA ");
  });
});
