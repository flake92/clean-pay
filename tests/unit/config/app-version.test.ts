import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { APP_VERSION } from "@/shared/app-version";

describe("application version", () => {
  it("keeps package metadata and the displayed version synchronized", () => {
    const packageJson = JSON.parse(readFileSync("package.json", "utf8")) as { version: string };
    const packageLock = JSON.parse(readFileSync("package-lock.json", "utf8")) as {
      version: string;
      packages: Record<string, { version?: string }>;
    };

    expect(APP_VERSION).toBe("0.1.1");
    expect(packageJson.version).toBe(APP_VERSION);
    expect(packageLock.version).toBe(APP_VERSION);
    expect(packageLock.packages[""]?.version).toBe(APP_VERSION);
  });

  it("renders the version in authenticated and authentication page footers", () => {
    expect(readFileSync("src/frontend/layout/AppFooter.tsx", "utf8")).toContain("Версия {APP_VERSION}");
    expect(readFileSync("src/frontend/components/auth-shell.tsx", "utf8")).toContain(
      "Версия {APP_VERSION}",
    );
  });
});
