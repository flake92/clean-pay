import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { safeRedirectPath } from "@/shared/auth/redirect-policy";
import { providerSessionRecoveryPath } from "@/shared/auth/session-navigation";

describe("post-auth redirect flow", () => {
  it("accepts only existing user-facing destinations", () => {
    expect(safeRedirectPath("/cabinet?tab=devices#active")).toBe(
      "/cabinet?tab=devices#active",
    );

    for (const pathname of [
      "/",
      "/cabinet",
      "/extend",
      "/install",
      "/link-account",
      "/offline",
      "/passkey/setup",
      "/payment",
      "/payment/fail",
      "/payment/pending",
      "/payment/success",
      "/profile",
      "/referral",
      "/register/verify-email",
      "/support",
      "/tariffs",
      "/verify-email",
    ]) {
      expect(safeRedirectPath(pathname)).toBe(pathname);
    }

    for (const unsafe of [
      null,
      "",
      "https://evil.example/path",
      "//evil.example/path",
      "/\\evil.example/path",
      "/missing",
      "/api",
      "/api/health",
      "/auth",
      "/login",
      "/register?next=/cabinet",
      "/auth/telegram/start",
      "/Cabinet",
      "/cabinet/",
      "/cabinet/missing",
      "/missing/../cabinet",
      "/invite/%2e%2e/cabinet",
      "/%2e/cabinet",
      "/%61uth/session/recover",
      "/\u0441abinet",
      "/%D1%81abinet",
      "/%d1%81abinet",
      "/%25D1%2581abinet",
      "/%D1%ZZabinet",
      "/%0Aabinet",
    ]) {
      expect(safeRedirectPath(unsafe)).toBeUndefined();
    }

    expect(safeRedirectPath(
      "/cabinet?label=%D0%9F%D1%80%D0%B8%D0%B2%D0%B5%D1%82#active",
    )).toBe(
      "/cabinet?label=%D0%9F%D1%80%D0%B8%D0%B2%D0%B5%D1%82#active",
    );
  });

  it("accepts only referral continuations backed by the dynamic invite route", () => {
    expect(safeRedirectPath("/invite/Friend42?source=email#continue")).toBe(
      "/invite/Friend42?source=email#continue",
    );
    expect(safeRedirectPath(`/invite/${"a".repeat(64)}`)).toBe(
      `/invite/${"a".repeat(64)}`,
    );

    for (const unsafe of [
      "/invite",
      "/invite/",
      "/Invite/Friend42",
      "/invite/ab",
      `/invite/${"a".repeat(65)}`,
      "/invite/friend_code",
      "/invite/Friend42/extra",
      "/invite/%46riend42",
      "/invite/\u0421ode42",
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
    const authForms = [
      readFileSync("src/frontend/components/auth-forms.tsx", "utf8"),
      readFileSync("src/frontend/hooks/use-auth-form-controller.ts", "utf8"),
    ].join("\n");
    const passkeys = [
      readFileSync("src/frontend/components/passkey-actions.tsx", "utf8"),
      readFileSync("src/frontend/hooks/use-passkey-actions-controller.ts", "utf8"),
      readFileSync("src/frontend/hooks/use-passkey-login-controller.ts", "utf8"),
    ].join("\n");
    const telegramStart = readFileSync("src/app/auth/telegram/start/route.ts", "utf8");
    const telegramWebAppController = readFileSync(
      "src/frontend/hooks/use-telegram-webapp-login-controller.ts",
      "utf8",
    );
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
    expect(passkeys).toContain("safeRedirectPath(redirectTo)");
    expect(passkeys).toContain("navigateTo(destination)");
    expect(telegramStart).toContain(
      'safeRedirectPath(url.searchParams.get("redirect_to"))',
    );
    expect(telegramWebAppController).toContain("authenticateTelegramWebAppAction(initData)");
    expect(telegramWebAppController).toContain("window.location.replace(redirectTo)");
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
