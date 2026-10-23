import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

async function iconsIn(files: string[]) {
  const root = mkdtempSync(join(tmpdir(), "cp-brand-"));
  mkdirSync(join(root, "public", "brand"), { recursive: true });
  for (const file of files) writeFileSync(join(root, "public", "brand", file), "x");
  vi.spyOn(process, "cwd").mockReturnValue(root);
  vi.resetModules();
  const { brandIcons } = await import("@/app/_composition/brand-assets");
  try {
    return brandIcons();
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

describe("owner brand assets", () => {
  afterEach(() => vi.restoreAllMocks());

  it("falls back to the bundled assets when public/brand is empty", async () => {
    expect(await iconsIn([])).toEqual({
      favicon: "/favicon.ico",
      faviconSvg: null,
      apple: { url: "/clean-pay-icon-192.png?v=3", sizes: "192x192" },
      icon192: "/clean-pay-icon-192.png",
      icon512: "/clean-pay-icon-512.png",
      maskable512: "/clean-pay-icon-maskable-512.png",
    });
  });

  it("uses every brand file that exists", async () => {
    expect(await iconsIn([
      "favicon.ico",
      "favicon.svg",
      "apple-touch-icon.png",
      "icon-192.png",
      "icon-512.png",
      "icon-maskable-512.png",
    ])).toEqual({
      favicon: "/brand/favicon.ico",
      faviconSvg: "/brand/favicon.svg",
      apple: { url: "/brand/apple-touch-icon.png", sizes: "180x180" },
      icon192: "/brand/icon-192.png",
      icon512: "/brand/icon-512.png",
      maskable512: "/brand/icon-maskable-512.png",
    });
  });

  it("keeps public/brand out of git but inside the image build", () => {
    expect(readFileSync(".gitignore", "utf8")).toMatch(/^\/public\/brand\/$/m);
    expect(readFileSync(".dockerignore", "utf8")).toContain("!public/**");
  });

  it("fails the image build when the baked logo path has no file", () => {
    const dockerfile = readFileSync("Dockerfile", "utf8");
    const copyPublic = dockerfile.indexOf("COPY public ./public");
    const logoCheck = dockerfile.indexOf('test -f "public${logo_path}"');
    expect(copyPublic).toBeGreaterThan(-1);
    expect(logoCheck).toBeGreaterThan(copyPublic);
    expect(logoCheck).toBeLessThan(dockerfile.indexOf("COPY src ./src"));
  });

  it("serves the default favicon from public, so metadata can replace it", () => {
    expect(() => readFileSync("src/app/favicon.ico")).toThrow();
    expect(readFileSync("public/favicon.ico").length).toBeGreaterThan(0);
  });
});
