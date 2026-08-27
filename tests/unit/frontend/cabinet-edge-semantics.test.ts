import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { formatDate } from "@/frontend/components/cabinet-presentation";

describe("cabinet deferred edge semantics", () => {
  it("continues to throw for an invalid provider date instead of inventing a fallback", () => {
    expect(() => formatDate("not-a-date")).toThrow(RangeError);
  });

  it("continues to render each payment with its own unnormalized currency", () => {
    const source = readFileSync(
      "src/frontend/components/cabinet-responsive-sections.tsx",
      "utf8",
    );

    expect(
      source.match(/\{payment\.final_amount\} \{payment\.currency\}/g),
    ).toHaveLength(2);
  });

  it("continues to let a synchronous Chatwoot reset failure stop logout", () => {
    const source = readFileSync(
      "src/frontend/components/cabinet-panel.tsx",
      "utf8",
    );
    const logoutStart = source.indexOf("async function logout()");
    const logoutEnd = source.indexOf("\n\n  if (error)", logoutStart);
    const logout = source.slice(logoutStart, logoutEnd);

    expect(logout.indexOf("resetChatwootSession()")).toBeGreaterThan(-1);
    expect(logout.indexOf("logoutAction()")).toBeGreaterThan(
      logout.indexOf("resetChatwootSession()"),
    );
    expect(logout).not.toContain("try");
    expect(logout).not.toContain("finally");
  });
});
