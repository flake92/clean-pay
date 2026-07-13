import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { resolveBranding } from "@/shared/branding";

describe("cabinet branding", () => {
  it("uses Clean Pay defaults when branding env is empty", () => {
    expect(resolveBranding({})).toEqual({
      name: "Clean Pay",
      logoUrl: "/logo.svg",
    });
  });

  it("accepts custom deployment-level branding", () => {
    expect(resolveBranding({
      NEXT_PUBLIC_BRAND_NAME: "Partner Cabinet",
      NEXT_PUBLIC_BRAND_LOGO_URL: "/brand/partner-logo.png",
    })).toEqual({
      name: "Partner Cabinet",
      logoUrl: "/brand/partner-logo.png",
    });
  });

  it("rejects unsafe logo paths and overlong names", () => {
    expect(() => resolveBranding({ NEXT_PUBLIC_BRAND_LOGO_URL: "https://cdn.example.com/logo.png" })).toThrow(
      "NEXT_PUBLIC_BRAND_LOGO_URL must be a root-relative public path",
    );
    expect(() => resolveBranding({ NEXT_PUBLIC_BRAND_LOGO_URL: "//cdn.example.com/logo.png" })).toThrow(
      "NEXT_PUBLIC_BRAND_LOGO_URL must be a root-relative public path",
    );
    expect(() => resolveBranding({ NEXT_PUBLIC_BRAND_NAME: "x".repeat(81) })).toThrow(
      "NEXT_PUBLIC_BRAND_NAME must be 80 characters or less",
    );
  });

  it("wires branding into visible shell surfaces and Docker build args", () => {
    const files = [
      "src/app/layout.tsx",
      "src/frontend/components/layout/auth-shell.tsx",
      "src/frontend/layout/AppTopbar.tsx",
      "src/frontend/layout/AppFooter.tsx",
      "src/frontend/layout/AppMenu.tsx",
      "src/frontend/layout/useCleanPayMenu.ts",
      "src/frontend/components/layout/page-header.tsx",
      "src/frontend/components/support-panel.tsx",
      "src/app/page.tsx",
      "src/app/tariffs/page.tsx",
      "src/app/profile/page.tsx",
    ];

    for (const file of files) {
      expect(readFileSync(file, "utf8"), `${file} should use branding`).toContain("getBranding");
    }

    expect(readFileSync("deploy/prod/Dockerfile", "utf8")).toContain("ARG NEXT_PUBLIC_BRAND_NAME");
    expect(readFileSync("deploy/prod/docker-compose.yml", "utf8")).toContain("NEXT_PUBLIC_BRAND_NAME");
  });
});
