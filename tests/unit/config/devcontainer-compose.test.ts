import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

const compose = readFileSync(path.resolve(__dirname, "../../../.devcontainer/docker-compose.yml"), "utf8");

function valueOf(name: string) {
  return compose.match(new RegExp(`^\\s*${name}:\\s*"?([^"\\n]*)"?\\s*$`, "m"))?.[1] ?? null;
}

describe("devcontainer compose wiring", () => {
  it("configures Remnashop email delivery through local Mailpit", () => {
    // Проверяем: dev-стенд не расходится с integration-стендом и может реально отправлять verification email.
    expect(valueOf("EMAIL_ENABLED")).toBe("true");
    expect(valueOf("EMAIL_HOST")).toBe("smtp");
    expect(valueOf("EMAIL_PORT")).toBe("1025");
    expect(valueOf("EMAIL_USERNAME")).toBeTruthy();
    expect(valueOf("EMAIL_PASSWORD")).toBeTruthy();
    expect(valueOf("SMTP_USERNAME")).toBeTruthy();
    expect(valueOf("SMTP_PASSWORD")).toBeTruthy();
    expect(valueOf("MAIL_USERNAME")).toBeTruthy();
    expect(valueOf("MAIL_PASSWORD")).toBeTruthy();
    expect(valueOf("MP_SMTP_AUTH_ACCEPT_ANY")).toBe("true");
    expect(valueOf("MP_SMTP_AUTH_ALLOW_INSECURE")).toBe("true");
  });
});
