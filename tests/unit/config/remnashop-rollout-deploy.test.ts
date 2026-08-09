import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

const rollout = readFileSync("deploy/prod/prepare-remnashop-rollout.sh", "utf8");
const deploy = readFileSync("deploy.sh", "utf8");
const start = readFileSync("start.sh", "utf8");
const prodCommand = readFileSync("deploy/prod/prod.mjs", "utf8");

describe("Remnashop payment rollout deployment", () => {
  it("runs automatically only after Clean Pay becomes ready", () => {
    expect(deploy.indexOf('sh "$REMNASHOP_ROLLOUT_SCRIPT" "$ENV_FILE"')).toBeGreaterThan(
      deploy.indexOf("compose up -d --build --wait"),
    );
    expect(start.indexOf('sh "$REMNASHOP_ROLLOUT_SCRIPT" "$ENV_FILE"')).toBeGreaterThan(
      start.indexOf("verify"),
    );
    expect(start).toMatch(
      /if \[ "\$MODE" = "remnashop" \]; then\s+sh "\$REMNASHOP_ROLLOUT_SCRIPT" "\$ENV_FILE"/,
    );
    expect(prodCommand.indexOf("prepareRemnashopPaymentRollout();")).toBeGreaterThan(
      prodCommand.indexOf("await verify();"),
    );
  });

  it("refuses to open the gate unless every rollout safety check passes", () => {
    expect(rollout).toContain("API, worker and scheduler must use the same image");
    expect(rollout).toContain("current_revision");
    expect(rollout).toContain('to_regclass(\'public.payment_runtime_control\')');
    expect(rollout).toContain("payment_operation_count <> 0");
    expect(rollout).toContain("active_fulfillment_count <> 0");
    expect(rollout).toContain("BEGIN;");
    expect(rollout).toContain("FOR UPDATE;");
    expect(rollout).toContain("pg_advisory_xact_lock");
    expect(rollout).toContain("COMMIT;");
  });

  it("is idempotent and verifies that the gate is disabled", () => {
    expect(rollout).toContain("IF rollout_gate_active THEN");
    expect(rollout).toContain("SET legacy_rollout_gate_active = false");
    expect(rollout).toContain("Payment rollout gate remained active");
  });
});
