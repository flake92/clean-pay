import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

const compose = readFileSync(path.resolve(__dirname, "../../../.devcontainer/docker-compose.yml"), "utf8");

function valueOf(name: string) {
  return compose.match(new RegExp(`^\\s*${name}:\\s*"?([^"\\n]*)"?\\s*$`, "m"))?.[1]?.trim() ?? null;
}

describe("devcontainer compose wiring", () => {
  it("does not hardcode a developer host path or chmod the Docker socket", () => {
    expect(compose).not.toContain("/Users/alex");
    expect(compose).not.toContain("CLEAN_PAY_DOCKER_HOST_ROOT");
    expect(compose).not.toContain("chmod 666 /var/run/docker.sock");
  });

  it("keeps generated Node and Next artifacts writable by the devcontainer user", () => {
    expect(compose).toContain("chown -R node:node /workspace/clean-pay/node_modules /home/node/.npm");
    expect(compose).toContain("chown -R node:node /workspace/clean-pay/.next");
  });

  it("configures Remnashop email delivery through local Mailpit", () => {
    // Keep the dev stack wired to real local email delivery.
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
    expect(valueOf("MP_WEBHOOK_URL")).toBe("http://smtp-log:8126/");
    expect(valueOf("MP_WEBHOOK_LIMIT")).toBe("0");
    expect(compose).toContain("smtp-log:");
    expect(compose).toContain("./mailpit-logger:/logger:ro");
  });
});
