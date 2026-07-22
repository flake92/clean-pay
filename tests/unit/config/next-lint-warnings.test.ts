import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

const filesWithLogo = [
  "src/frontend/components/layout/auth-shell.tsx",
  "src/frontend/layout/AppTopbar.tsx",
  "src/frontend/layout/AppFooter.tsx",
];

describe("Next lint warning guardrails", () => {
  it("does not manually inject theme stylesheets in the app layout", () => {
    const layout = readFileSync("src/app/layout.tsx", "utf8");

    expect(layout).toContain('import "../../public/themes/lara-light-indigo/theme.css";');
    expect(layout).not.toContain('rel="stylesheet"');
    expect(layout).not.toContain("theme-css");
  });

  it("keeps Prime form controls visible when Tailwind preflight wins the cascade", () => {
    const globals = readFileSync("src/app/globals.css", "utf8");

    expect(globals).toMatch(/\.p-inputtext\s*\{[\s\S]*background:\s*#ffffff;/);
    expect(globals).toMatch(/\.p-inputtext\s*\{[\s\S]*border:\s*1px solid #d1d5db;/);
    expect(globals).toMatch(/\.p-inputtext\s*\{[\s\S]*padding:\s*0\.75rem 0\.75rem;/);
    expect(globals).toMatch(/\.p-button\s*\{[\s\S]*background:\s*#6366f1;/);
    expect(globals).toMatch(/\.p-button\s*\{[\s\S]*border:\s*1px solid #6366f1;/);
    expect(globals).toMatch(/\.p-button\s*\{[\s\S]*min-height:\s*3\.125rem;/);
    expect(globals).toMatch(/\.p-button\s*\{[\s\S]*padding:\s*0\.875rem 1\.25rem;/);
    expect(globals).toMatch(/\.p-button\s*\{[\s\S]*white-space:\s*nowrap;/);
    expect(globals).toMatch(/\.p-tag\s*\{[\s\S]*min-height:\s*1\.625rem;/);
    expect(globals).toMatch(/\.p-tag\s*\{[\s\S]*padding:\s*0\.25rem 0\.5rem;/);
  });

  it("uses next/image for Clean Pay logo rendering", () => {
    for (const file of filesWithLogo) {
      const source = readFileSync(file, "utf8");

      expect(source, `${file} should import next/image`).toContain('from "next/image"');
      expect(source, `${file} should not render raw img tags`).not.toMatch(/<img\b/);
      expect(source, `${file} should load the precached local logo directly`).toContain("unoptimized");
      expect(source, `${file} should not disable Next image lint`).not.toContain(
        "@next/next/no-img-element",
      );
    }
  });
});
