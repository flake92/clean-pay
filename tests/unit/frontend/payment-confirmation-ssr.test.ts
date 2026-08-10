import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  navigateTo: vi.fn(),
  replaceWith: vi.fn(),
}));

vi.mock("@/app/actions/payments", () => ({
  executePaymentAction: vi.fn(),
}));
vi.mock("@/frontend/lib/browser-navigation", () => ({
  navigateTo: mocks.navigateTo,
  replaceWith: mocks.replaceWith,
}));

import { ExtendConfirmation } from "@/frontend/components/extend-confirmation";
import { PaymentConfirmation } from "@/frontend/components/payment-confirmation";

const verifyEmailModel = {
  status: "account-action-required" as const,
  action: "verifyEmail" as const,
  message: "pending",
};

describe("payment confirmation server rendering", () => {
  it("does not access browser navigation while rendering a purchase on the server", () => {
    expect(() => renderToString(createElement(PaymentConfirmation, {
      model: verifyEmailModel,
      paymentRedirectTo: "/payment?plan=pro",
    }))).not.toThrow();
    expect(mocks.replaceWith).not.toHaveBeenCalled();
  });

  it("does not access browser navigation while rendering an extension on the server", () => {
    expect(() => renderToString(createElement(ExtendConfirmation, {
      model: verifyEmailModel,
      requestedDuration: "30",
      requestedGateway: "CARD",
    }))).not.toThrow();
    expect(mocks.replaceWith).not.toHaveBeenCalled();
  });
});
