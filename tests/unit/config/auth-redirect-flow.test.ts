import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { safeRedirectPath } from "@/shared/auth/redirect-policy";
import { providerSessionRecoveryPath } from "@/shared/auth/session-navigation";

describe("post-auth redirect flow", () => {
  it("accepts only local non-auth destinations", () => {
    expect(safeRedirectPath("/cabinet?tab=devices#active")).toBe(
      "/cabinet?tab=devices#active",
    );

    for (const unsafe of [
      null,
      "",
      "https://evil.example/path",
      "//evil.example/path",
      "/\\evil.example/path",
      "/login",
      "/register?next=/cabinet",
      "/auth/telegram/start",
    ]) {
      expect(safeRedirectPath(unsafe)).toBeUndefined();
    }
  });

  it("builds provider recovery URLs only for safe local destinations", () => {
    expect(providerSessionRecoveryPath("/payment?plan=pro&duration=30")).toBe(
      "/auth/session/recover?return_to=%2Fpayment%3Fplan%3Dpro%26duration%3D30",
    );
    expect(providerSessionRecoveryPath("https://evil.example/cabinet")).toBe(
      "/auth/session/recover?return_to=%2Fcabinet",
    );
  });

  it("threads the validated destination through password, passkey and Telegram login", () => {
    const loginPage = readFileSync("src/app/login/page.tsx", "utf8");
    const authForms = readFileSync("src/frontend/components/auth-forms.tsx", "utf8");
    const passkeys = readFileSync("src/frontend/components/passkey-actions.tsx", "utf8");
    const telegramStart = readFileSync("src/app/auth/telegram/start/route.ts", "utf8");
    const telegramWebApp = readFileSync("src/frontend/components/telegram-webapp-login.tsx", "utf8");
    const telegramWebAppPage = readFileSync(
      "src/app/auth/telegram/webapp/page.tsx",
      "utf8",
    );

    expect(loginPage).toContain("safeRedirectPath(rawRedirect)");
    expect(loginPage).toContain("redirectTo={redirectTo}");
    expect(loginPage).toContain("initialError={initialError}");
    expect(loginPage).toContain("<TelegramLoginButton redirectTo={redirectTo} />");
    expect(authForms).toContain("redirectAfterAuth(redirectTo)");
    expect(authForms).toContain("redirectTo={redirectTo}");
    expect(authForms).toContain("turnstileEnabled={turnstile.enabled}");
    expect(passkeys).toContain("navigateTo(redirectTo)");
    expect(telegramStart).toContain(
      'safeRedirectPath(url.searchParams.get("redirect_to"))',
    );
    expect(telegramWebApp).toContain("authenticateTelegramWebAppAction(initData)");
    expect(telegramWebApp).toContain("window.location.replace(redirectTo)");
    expect(telegramWebAppPage).toContain("safeRedirectPath(rawRedirect)");
    expect(telegramWebAppPage).toContain(
      "<TelegramWebAppLogin redirectTo={redirectTo} />",
    );

    const registrationVerification = readFileSync(
      "src/frontend/components/register-email-confirm-form.tsx",
      "utf8",
    );
    const registrationVerificationPage = readFileSync(
      "src/app/register/verify-email/page.tsx",
      "utf8",
    );
    expect(registrationVerificationPage).toContain(
      "safeAccountSetupDestination(rawRedirect)",
    );
    expect(registrationVerification).toContain(
      "passkeySetupPath(redirectTo)",
    );
  });
});
