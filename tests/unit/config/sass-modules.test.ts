import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

const layoutFiles = [
  "src/frontend/styles/layout/layout.scss",
  "src/frontend/styles/layout/_topbar.scss",
  "src/frontend/styles/layout/_menu.scss",
  "src/frontend/styles/layout/_content.scss",
  "src/frontend/styles/layout/_footer.scss",
  "src/frontend/styles/layout/_responsive.scss",
  "src/frontend/styles/layout/_utils.scss",
  "src/frontend/styles/layout/_typography.scss",
];

describe("layout Sass modules", () => {
  it("uses Sass module syntax instead of deprecated layout @import rules", () => {
    for (const file of layoutFiles) {
      expect(readFileSync(file, "utf8"), `${file} should not use Sass @import`).not.toMatch(
        /@import\b/,
      );
    }
  });

  it("keeps variable and mixin dependencies explicit in partials", () => {
    const topbar = readFileSync("src/frontend/styles/layout/_topbar.scss", "utf8");
    const menu = readFileSync("src/frontend/styles/layout/_menu.scss", "utf8");
    const content = readFileSync("src/frontend/styles/layout/_content.scss", "utf8");

    expect(topbar).toContain('@use "./variables" as *;');
    expect(topbar).toContain('@use "./mixins" as *;');
    expect(menu).toContain('@use "./variables" as *;');
    expect(menu).toContain('@use "./mixins" as *;');
    expect(content).toContain('@use "./variables" as *;');
  });
});
