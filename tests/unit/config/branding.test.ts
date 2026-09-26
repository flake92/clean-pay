import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { resolveBranding } from "@/shared/branding";

describe("cabinet branding", () => {
  it("uses Clean Pay defaults when branding env is empty", () => {
    expect(resolveBranding({})).toEqual({
      name: "Clean Pay",
      logoUrl: "/clean-pay-logo.png",
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
      "src/app/install/page.tsx",
      "src/app/offline/page.tsx",
      "src/frontend/components/auth-shell.tsx",
      "src/frontend/components/install-app-button.tsx",
      "src/frontend/components/ios-install-guide.tsx",
      "src/frontend/layout/AppTopbar.tsx",
      "src/frontend/layout/AppFooter.tsx",
      "src/frontend/layout/AppMenu.tsx",
      "src/frontend/layout/useCleanPayMenu.ts",
      "src/frontend/components/page-header.tsx",
      "src/frontend/components/support-panel.tsx",
      "src/app/tariffs/page.tsx",
      "src/app/profile/page.tsx",
    ];

    for (const file of files) {
      expect(readFileSync(file, "utf8"), `${file} should use branding`).toContain("getBranding");
    }

    expect(readFileSync("Dockerfile", "utf8")).toContain(
      'ARG NEXT_PUBLIC_BRAND_NAME="Clean Pay"',
    );
    expect(readFileSync("Dockerfile", "utf8")).toContain(
      "ENV CLEAN_PAY_BAKED_BRAND_NAME=${NEXT_PUBLIC_BRAND_NAME}",
    );
    expect(readFileSync("deploy/prod/docker-compose.yml", "utf8")).toContain("NEXT_PUBLIC_BRAND_NAME");
  });

  it("uses direct public env reads so Next.js can inline branding in client bundles", () => {
    const branding = readFileSync("src/shared/branding.ts", "utf8");

    expect(branding).toContain("process.env.NEXT_PUBLIC_BRAND_NAME");
    expect(branding).toContain("process.env.NEXT_PUBLIC_BRAND_LOGO_URL");
    expect(branding).not.toContain("env = process.env");

    for (const file of [
      "src/app/install/page.tsx",
      "src/app/offline/page.tsx",
      "src/frontend/components/install-app-button.tsx",
      "src/frontend/components/ios-install-guide.tsx",
    ]) {
      const source = readFileSync(file, "utf8");
      expect(source, `${file} should resolve deployment branding`).toContain("getBranding");
      expect(source, `${file} should not hard-code the default brand`).not.toMatch(/\bClean Pay\b/);
    }
  });
});
