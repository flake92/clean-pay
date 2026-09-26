import { readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";

import { describe, expect, it } from "vitest";

import ProviderSessionRecoveryPage from "@/app/auth/session/recovery/page";

describe("provider session recovery browser page", () => {
  it("replaces the raw transient JSON with a bounded, user-facing retry flow", () => {
    const route = readFileSync(
      "src/app/auth/session/recover/route.ts",
      "utf8",
    );
    const page = readFileSync(
      "src/app/auth/session/recovery/page.tsx",
      "utf8",
    );

    expect(route).toContain('new URL("/auth/session/recovery"');
    expect(route).toContain('accept.includes("application/json")');
    expect(route).toContain('!accept.includes("text/html")');
    expect(page).toContain("Вход выполнен");
    expect(page).toContain("Повторить восстановление");
    expect(page).toContain('kind === "session"');
    expect(page).toContain('"/auth/session/refresh"');
    expect(page).toContain("safeRedirectPath");
    expect(page).toContain("safeAuthenticationFallback");
    expect(page).toContain('retryParams.set("fallback_to", fallbackTo)');
    expect(page).toContain("parsed <= 3_600");
  });

  it("keeps only a canonical auth fallback in the browser retry link", async () => {
    const validHtml = renderToStaticMarkup(await ProviderSessionRecoveryPage({
      searchParams: Promise.resolve({
        return_to: "/payment?plan=pro",
        fallback_to: "/register?redirect_to=%2Fpayment%3Fplan%3Dpro",
        kind: "session",
      }),
    }));
    expect(validHtml).toContain(
      "fallback_to=%2Fregister%3Fredirect_to%3D%252Fpayment%253Fplan%253Dpro",
    );

    const forgedHtml = renderToStaticMarkup(await ProviderSessionRecoveryPage({
      searchParams: Promise.resolve({
        return_to: "/profile",
        fallback_to: "//evil.example/register?redirect_to=/profile",
        kind: "session",
      }),
    }));
    expect(forgedHtml).not.toContain("fallback_to=");
  });
});
