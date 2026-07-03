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

  it("uses next/image for Clean Pay logo rendering", () => {
    for (const file of filesWithLogo) {
      const source = readFileSync(file, "utf8");

      expect(source, `${file} should import next/image`).toContain('from "next/image"');
      expect(source, `${file} should not render raw img tags`).not.toMatch(/<img\b/);
      expect(source, `${file} should not disable Next image lint`).not.toContain(
        "@next/next/no-img-element",
      );
    }
  });
});
