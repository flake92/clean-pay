import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

describe("Passkey trust-boundary copy", () => {
  it("describes local login and the upstream step-up requirement explicitly", () => {
    const source = readFileSync("src/frontend/components/passkey-actions.tsx", "utf8");

    expect(source).toContain("Passkey восстанавливает локальную сессию CleanPay");
    expect(source).toContain("сессия RemnaShop истекла");
    expect(source).toContain("подтверждение через e-mail либо Telegram");
    expect(source).toContain('action="passkey_login"');
  });
});
