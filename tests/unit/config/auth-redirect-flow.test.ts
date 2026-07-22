import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { safeRedirectPath } from "@/shared/auth/redirect-policy";

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

  it("threads the validated destination through password, passkey and Telegram login", () => {
    const loginPage = readFileSync("src/app/login/page.tsx", "utf8");
    const authForms = readFileSync("src/frontend/components/auth-forms.tsx", "utf8");
    const passkeys = readFileSync("src/frontend/components/passkey-actions.tsx", "utf8");
    const telegramStart = readFileSync("src/app/auth/telegram/start/route.ts", "utf8");
    const telegramWebApp = readFileSync(
      "src/app/api/bff/auth/telegram/webapp/route.ts",
      "utf8",
    );
    const telegramWebAppPage = readFileSync(
      "src/app/auth/telegram/webapp/page.tsx",
      "utf8",
    );

    expect(loginPage).toContain("safeRedirectPath(rawRedirect)");
    expect(loginPage).toContain("<LoginForm redirectTo={redirectTo} />");
    expect(loginPage).toContain("<TelegramLoginButton redirectTo={redirectTo} />");
    expect(authForms).toContain("redirectAfterAuth(redirectTo)");
    expect(authForms).toContain("<PasskeyLoginButton redirectTo={redirectTo} />");
    expect(passkeys).toContain("window.location.assign(redirectTo)");
    expect(telegramStart).toContain(
      'safeRedirectPath(url.searchParams.get("redirect_to"))',
    );
    expect(telegramWebApp).toContain("safeRedirectPath(");
    expect(telegramWebApp).toContain("NextResponse.json({ redirectTo })");
    expect(telegramWebAppPage).toContain("safeRedirectPath(rawRedirect)");
    expect(telegramWebAppPage).toContain(
      "<TelegramWebAppLogin redirectTo={redirectTo} />",
    );
  });
});
