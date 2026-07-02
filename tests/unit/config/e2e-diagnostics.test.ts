import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

const rootDir = path.resolve(__dirname, "../../..");
const nodeRunner = readFileSync(path.join(rootDir, "scripts/e2e-devcontainer.mjs"), "utf8");
const runner = readFileSync(path.join(rootDir, "scripts/e2e-devcontainer.sh"), "utf8");
const waitForHttp = readFileSync(path.join(rootDir, "scripts/wait-for-http.sh"), "utf8");
const fullStackTest = readFileSync(path.join(rootDir, "tests/e2e/full-stack/full-stack.test.ts"), "utf8");

describe("e2e diagnostics", () => {
  it("prints the failed shell step, URLs and service logs", () => {
    expect(runner).toContain("Failed step: $current_step");
    expect(runner).toContain("Base URL: $base_url");
    expect(runner).toContain("Mailpit URL: $mailpit_url");
    expect(runner).toContain("OIDC URL: $oidc_url");
    expect(runner).toContain("compose logs --tail=160");
    expect(runner).toContain("smtp-log");
  });

  it("prints HTTP wait method, URL, status and response body", () => {
    expect(waitForHttp).toContain("Step: $step_name");
    expect(waitForHttp).toContain("Method: $method");
    expect(waitForHttp).toContain("URL: $url");
    expect(waitForHttp).toContain("Last status: $last_status");
    expect(waitForHttp).toContain("Response body:");
  });

  it("includes response URL, status and body in Vitest assertion diagnostics", () => {
    expect(fullStackTest).toContain("url: response.url");
    expect(fullStackTest).toContain("status: response.status");
    expect(fullStackTest).toContain("body: body.slice(0, 2000)");
    expect(fullStackTest).toContain("e2eCompose.logs");
  });

  it("runs host-triggered e2e commands as the devcontainer user", () => {
    expect(nodeRunner).toContain('"exec", "-T", "-u", "node"');
  });
});
