import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

describe("public authentication copy", () => {
  it("describes the Passkey step-up without exposing internal service names", () => {
    const passkeySource = readFileSync("src/frontend/components/passkey-actions.tsx", "utf8");
    const renewalSource = readFileSync("src/frontend/components/extend-confirmation.tsx", "utf8");

    expect(passkeySource).toContain("Passkey восстанавливает вход на этом устройстве");
    expect(passkeySource).toContain("подтверждение через e-mail либо Telegram");
    expect(passkeySource).not.toMatch(/Remnashop|Remnawave/i);
    expect(renewalSource).not.toMatch(/text="[^"]*(?:Remnashop|Remnawave)/i);
  });

  it("renders one shared Turnstile widget for every login method", () => {
    const authFormsSource = readFileSync("src/frontend/components/auth-forms.tsx", "utf8");
    const passkeySource = readFileSync("src/frontend/components/passkey-actions.tsx", "utf8");

    expect(authFormsSource.match(/<TurnstileWidget/g)).toHaveLength(1);
    expect(authFormsSource).toContain('action="auth_login"');
    expect(authFormsSource).toContain("consumeToken");
    expect(passkeySource).not.toContain("<TurnstileWidget");
    expect(authFormsSource).not.toContain("Ответ одинаков для нового и существующего аккаунта");
  });
});
