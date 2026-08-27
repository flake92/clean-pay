import { describe, expect, it } from "vitest";

import { passwordToggleA11y } from "@/frontend/components/password-toggle-a11y";

describe("password toggle accessible names", () => {
  it("keeps every field-context action unique and distinct from the field label", () => {
    const labels = Object.values(passwordToggleA11y).flatMap((passThrough) => [
      (passThrough.hideIcon as { "aria-label": string })["aria-label"],
      (passThrough.showIcon as { "aria-label": string })["aria-label"],
    ]);

    expect(new Set(labels).size).toBe(labels.length);
    expect(labels.every((label) => !/пароль/i.test(label))).toBe(true);
  });
});
