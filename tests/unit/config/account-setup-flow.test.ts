import { describe, expect, it } from "vitest";

import {
  accountLinkPath,
  accountSetupCompletePath,
  emailVerificationPath,
  hasAccountSetupNotice,
  isPaymentDestination,
  passkeySetupPath,
  registrationEmailVerificationPath,
  resolveEmailVerificationSetup,
  safeAccountSetupDestination,
} from "@/shared/auth/account-setup-flow";

const paymentPath = "/payment?plan=pro&duration=30&gateway=card";

describe("guided account setup redirects", () => {
  it("threads the exact local payment selection through every setup step", () => {
    expect(accountLinkPath(paymentPath)).toBe(
      "/link-account?reason=email-required&redirect_to=%2Fpayment%3Fplan%3Dpro%26duration%3D30%26gateway%3Dcard",
    );
    expect(
      accountLinkPath(paymentPath, { passwordRequired: true }),
    ).toBe(
      "/link-account?reason=email-required&step=password&redirect_to=%2Fpayment%3Fplan%3Dpro%26duration%3D30%26gateway%3Dcard",
    );
    expect(emailVerificationPath(paymentPath)).toBe(
      "/verify-email?flow=telegram-email&redirect_to=%2Fpayment%3Fplan%3Dpro%26duration%3D30%26gateway%3Dcard",
    );
    expect(passkeySetupPath(paymentPath)).toBe(
      "/passkey/setup?redirect_to=%2Fpayment%3Fplan%3Dpro%26duration%3D30%26gateway%3Dcard",
    );
    expect(registrationEmailVerificationPath(paymentPath)).toBe(
      "/register/verify-email?redirect_to=%2Fpayment%3Fplan%3Dpro%26duration%3D30%26gateway%3Dcard",
    );
    expect(accountSetupCompletePath(paymentPath)).toBe(
      "/payment?plan=pro&duration=30&gateway=card&account_setup=account-ready",
    );
  });

  it("rejects external, API and recursive setup destinations", () => {
    for (const unsafe of [
      "https://evil.example/payment",
      "//evil.example/payment",
      "/api",
      "/api/bff/auth/me",
      "/auth/",
      "/link-account?redirect_to=/payment",
      "/link-account/",
      "/verify-email",
      "/verify-email/",
      "/passkey/setup",
      "/passkey/setup/",
    ]) {
      expect(safeAccountSetupDestination(unsafe)).toBe("/cabinet");
    }
  });

  it("keeps verification guided while replacing a missing or unsafe destination", () => {
    for (const unsafe of [undefined, "https://evil.example/payment", "/api"]) {
      expect(
        resolveEmailVerificationSetup("telegram-email", unsafe),
      ).toEqual({
        guided: true,
        redirectTo: "/cabinet",
      });
    }

    expect(
      resolveEmailVerificationSetup(undefined, paymentPath),
    ).toEqual({
      guided: false,
      redirectTo: "/profile",
    });
  });

  it("recognizes only the explicit completion notice and payment destination", () => {
    expect(
      hasAccountSetupNotice(
        new URLSearchParams("account_setup=account-ready"),
      ),
    ).toBe(true);
    expect(
      hasAccountSetupNotice(new URLSearchParams("account_setup=anything")),
    ).toBe(false);
    expect(isPaymentDestination(paymentPath)).toBe(true);
    expect(isPaymentDestination("/tariffs")).toBe(false);
  });
});
