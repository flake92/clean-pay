import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

const rollout = readFileSync("deploy/prod/prepare-remnashop-rollout.sh", "utf8");
const deploy = readFileSync("deploy.sh", "utf8");
const start = readFileSync("start.sh", "utf8");
const prodCommand = readFileSync("deploy/prod/prod.mjs", "utf8");

describe("Remnashop payment rollout deployment", () => {
  it("checks compatibility before replacement and finalizes only after readiness", () => {
    const deployInstall = deploy.slice(
      deploy.indexOf("install_services() {"),
      deploy.indexOf("up() {"),
    );
    const startInstall = start.slice(start.indexOf("start() {"), start.indexOf("verify() {"));
    const prodInstall = prodCommand.slice(
      prodCommand.indexOf('case "up":'),
      prodCommand.indexOf('case "down":'),
    );

    expect(deployInstall.indexOf('sh "$REMNASHOP_ROLLOUT_SCRIPT" "$ENV_FILE" check')).toBeLessThan(
      deployInstall.indexOf("stop_runtime_services"),
    );
    expect(deployInstall.indexOf('sh "$REMNASHOP_ROLLOUT_SCRIPT" "$ENV_FILE" finalize')).toBeGreaterThan(
      deployInstall.indexOf("verify_detailed_readiness"),
    );
    expect(startInstall.indexOf('sh "$REMNASHOP_ROLLOUT_SCRIPT" "$ENV_FILE" check')).toBeLessThan(
      startInstall.indexOf("stop_runtime_services"),
    );
    expect(startInstall.indexOf('sh "$REMNASHOP_ROLLOUT_SCRIPT" "$ENV_FILE" finalize')).toBeGreaterThan(
      startInstall.indexOf("verify"),
    );
    expect(start).toMatch(
      /if \[ "\$MODE" = "remnashop" \]; then\s+sh "\$REMNASHOP_ROLLOUT_SCRIPT" "\$ENV_FILE" check/,
    );
    expect(prodInstall.indexOf('prepareRemnashopPaymentRollout("check");')).toBeLessThan(
      prodInstall.indexOf("stopRuntimeServices();"),
    );
    expect(prodInstall.indexOf('prepareRemnashopPaymentRollout("finalize");')).toBeGreaterThan(
      prodInstall.indexOf("await verify();"),
    );
  });

  it("refuses to open the gate unless every rollout safety check passes", () => {
    expect(rollout).toContain("API, worker and scheduler must use the same image");
    expect(rollout).toContain("current_revision");
    expect(rollout).toContain('to_regclass(\'public.payment_runtime_control\')');
    expect(rollout).toContain('to_regclass(\'public.subscription_email_reminders\')');
    expect(rollout).toContain("FROM information_schema.columns");
    expect(rollout).toContain("table_schema = 'public'");
    expect(rollout).toContain("table_name = 'users'");
    expect(rollout).toContain("'subscription_expiration_email_enabled'");
    expect(rollout).toContain("'subscription_expiration_email_enabled_at'");
    expect(rollout).toContain("count(DISTINCT column_name)");
    expect(rollout).toContain("= 2");
    expect(rollout).toContain("/api/v1/public/auth/notification-preferences");
    expect(rollout).toContain('contract_statuses" = "422 405');
    expect(rollout.indexOf('if [ "$PHASE" = "check" ]')).toBeLessThan(
      rollout.indexOf("pg_advisory_xact_lock"),
    );
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
