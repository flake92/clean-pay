import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { PRODUCTION_ROLE_ENVIRONMENT_NAMES } from "../../../deploy/prod/role-env.mjs";

const compose = readFileSync("deploy/prod/docker-compose.yml", "utf8");
const rootCompose = readFileSync("docker-compose.yml", "utf8");
const prod = readFileSync("deploy/prod/prod.mjs", "utf8");
const deploy = readFileSync("deploy.sh", "utf8");
const rootStart = readFileSync("start.sh", "utf8");
const validator = readFileSync("deploy/prod/validate-env.mjs", "utf8");
const zeroDowntime = readFileSync("deploy/prod/zero-downtime-app.sh", "utf8");
const zeroDowntimeGuard = readFileSync("deploy/prod/zero-downtime-env.mjs", "utf8");
const dockerfile = readFileSync("Dockerfile", "utf8");
const roleEnvironment = readFileSync("deploy/prod/role-env.mjs", "utf8");
const credentialFileGuard = readFileSync("deploy/prod/credential-file-guard.mjs", "utf8");

describe("production role-scoped environment boundary", () => {
  it("gives provision the exact policy inputs used by the isolated worker", () => {
    const policyNames = [
      "AUDIT_INFO_RETENTION_DAYS",
      "AUDIT_SECURITY_RETENTION_DAYS",
      "AUTH_STATE_RETENTION_DAYS",
      "PAYMENT_HOLD_DISPOSED_RETENTION_DAYS",
      "PAYMENT_OPERATION_SNAPSHOT_RETENTION_DAYS",
      "PAYMENT_SENSITIVE_RETENTION_DAYS",
      "RATE_LIMIT_RETENTION_DAYS",
      "SESSION_RETENTION_DAYS",
    ];
    expect(PRODUCTION_ROLE_ENVIRONMENT_NAMES.provision).toEqual(
      expect.arrayContaining(policyNames),
    );
    expect(PRODUCTION_ROLE_ENVIRONMENT_NAMES.retention).toEqual(
      expect.arrayContaining(policyNames),
    );
    expect(PRODUCTION_ROLE_ENVIRONMENT_NAMES.provision).not.toContain(
      "DATA_RETENTION_INTERVAL_SECONDS",
    );
  });

  it("does not inject the authoritative environment bundle into a service", () => {
    for (const candidate of [compose, rootCompose]) {
      expect(candidate).not.toMatch(
        /env_file:\s*(?:\n\s*-\s*)?\.env(?:\s|$)/,
      );
      expect(candidate).toContain("${CLEAN_PAY_APP_ENV_FILE:-.env.app}");
      expect(candidate).toContain("${CLEAN_PAY_HOLD_OPERATOR_ENV_FILE:-.env.hold-operator}");
      expect(candidate).toContain("${CLEAN_PAY_MIGRATION_ENV_FILE:-.env.migration}");
      expect(candidate).toContain("${CLEAN_PAY_PROVISION_ENV_FILE:-.env.provision}");
      expect(candidate).toContain("${CLEAN_PAY_RECONCILIATION_ENV_FILE:-.env.reconciliation}");
      expect(candidate).toContain("${CLEAN_PAY_RETENTION_ENV_FILE:-.env.retention}");
      expect(candidate).toContain("${CLEAN_PAY_POSTGRES_ENV_FILE:-.env.postgres}");
      expect(candidate).toContain("CLEAN_PAY_RUNTIME_ROLE: migration");
      expect(candidate).toContain("CLEAN_PAY_RUNTIME_ROLE: application");
      expect(candidate).toContain("CLEAN_PAY_RUNTIME_ROLE: reconciliation");
      expect(candidate).toContain("CLEAN_PAY_RUNTIME_ROLE: retention");
      expect(candidate).toContain("CLEAN_PAY_RUNTIME_ROLE: hold-operator");
      expect(candidate).toContain("CLEAN_PAY_RUNTIME_ROLE: provision");
    }
    const applicationAllowlist = roleEnvironment
      .split("application: Object.freeze([")[1]
      ?.split("]),")[0] ?? "";
    expect(applicationAllowlist).toContain('"DATABASE_URL"');
    expect(applicationAllowlist).not.toContain('"POSTGRES_DB"');
    expect(applicationAllowlist).not.toContain('"POSTGRES_USER"');
    expect(applicationAllowlist).not.toContain('"POSTGRES_PASSWORD"');
  });

  it("materializes role files before standard and zero-downtime startup", () => {
    expect(prod).toContain("materializeProductionRoleEnvironmentFiles(envFile)");
    expect(prod).toContain("CLEAN_PAY_APP_ENV_FILE: roleEnvironmentFiles.application");
    expect(prod).toContain("CLEAN_PAY_PROVISION_ENV_FILE: roleEnvironmentFiles.provision");
    expect(zeroDowntime).toContain('node "$ROLE_ENV_SCRIPT" materialize "$ENV_FILE"');
    expect(zeroDowntime).toContain('--env-file "$APP_ENV_FILE"');
    expect(zeroDowntime).toContain('--env-file "$MIGRATION_ENV_FILE"');
    const deployPrepare = deploy.slice(
      deploy.indexOf("prepare_compose() {"),
      deploy.indexOf("available_disk_kb() {"),
    );
    expect(deployPrepare.indexOf("materialize_role_env_files")).toBeLessThan(
      deployPrepare.indexOf("compose config --quiet"),
    );
    expect(deploy).toContain("CLEAN_PAY_APP_ENV_FILE=$APP_ENV_FILE");
    expect(rootStart).toContain('node "$ROLE_ENV_SCRIPT" materialize "$ENV_FILE"');
    expect(rootStart).toContain("CLEAN_PAY_APP_ENV_FILE=$APP_ENV_FILE");
    expect(roleEnvironment.indexOf("renameSync(temporaryPath, path)")).toBeLessThan(
      roleEnvironment.indexOf("fsyncDirectory(dirname(path))"),
    );
    expect(roleEnvironment).toContain("fsyncSync(descriptor)");
  });

  it("replaces inherited role-file path overrides with authoritative derivatives", () => {
    const expected = {
      CLEAN_PAY_APP_ENV_FILE: "$APP_ENV_FILE",
      CLEAN_PAY_HOLD_OPERATOR_ENV_FILE: "$HOLD_OPERATOR_ENV_FILE",
      CLEAN_PAY_MIGRATION_ENV_FILE: "$MIGRATION_ENV_FILE",
      CLEAN_PAY_POSTGRES_ENV_FILE: "$POSTGRES_ENV_FILE",
      CLEAN_PAY_PROVISION_ENV_FILE: "$PROVISION_ENV_FILE",
      CLEAN_PAY_RECONCILIATION_ENV_FILE: "$RECONCILIATION_ENV_FILE",
      CLEAN_PAY_RETENTION_ENV_FILE: "$RETENTION_ENV_FILE",
    } as const;

    for (const entrypoint of [deploy, rootStart, zeroDowntime]) {
      const composeFunction = entrypoint.slice(
        entrypoint.indexOf("compose() ("),
        entrypoint.indexOf("\n)", entrypoint.indexOf("compose() (")) + 2,
      );
      const unsetBlock = composeFunction.slice(
        composeFunction.indexOf("unset \\"),
        composeFunction.indexOf("if ["),
      );
      for (const [name, path] of Object.entries(expected)) {
        expect(unsetBlock).toContain(name);
        expect(composeFunction).toContain(`${name}=${path}`);
        expect(composeFunction.indexOf(`${name}=${path}`)).toBeGreaterThan(
          composeFunction.indexOf("unset \\"),
        );
      }
    }
  });

  it("recreates runtime containers when role credentials change", () => {
    const restartBranch = deploy.slice(
      deploy.indexOf("  restart)"),
      deploy.indexOf(";;", deploy.indexOf("  restart)")) + 2,
    );
    const imagePreflight = deploy.slice(
      deploy.indexOf("preflight_runtime_restart_image() {"),
      deploy.indexOf("restart_runtime_services() {"),
    );
    const runtimeRestart = deploy.slice(
      deploy.indexOf("restart_runtime_services() {"),
      deploy.indexOf("cleanup_build_artifacts() {"),
    );

    expect(restartBranch).toContain("prepare_compose");
    expect(restartBranch).toContain("restart_runtime_services");
    expect(restartBranch).not.toContain("compose restart");

    expect(imagePreflight).toContain("compose ps --all --quiet app");
    expect(imagePreflight).toContain("docker inspect --format '{{.Image}}'");
    expect(imagePreflight).toContain('io.clean-pay.role');
    expect(imagePreflight).toContain("deploy/prod/validate-env.mjs --runtime-env-stdin");
    expect(imagePreflight).toContain("preflight_images");
    expect(imagePreflight).toContain('"$restart_app_image"');
    expect(imagePreflight).toContain(
      '[ "$CLEAN_PAY_VERIFIED_APP_IMAGE" = "$restart_app_image" ]',
    );

    expect(runtimeRestart).toContain(
      "compose rm -f -s reconciliation-worker retention-worker app",
    );
    expect(runtimeRestart).toContain("start_verified_runtimes");
    expect(runtimeRestart).toContain("verify_detailed_readiness");
    expect(runtimeRestart).not.toContain("compose restart");
    expect(runtimeRestart).not.toContain("--force-recreate");
  });

  it("shares strict metadata checks across every env-file entry point", () => {
    expect(prod).toContain("readPrivateCredentialFile(");
    expect(validator).toContain("readPrivateCredentialFile(");
    expect(zeroDowntimeGuard).toContain("readPrivateCredentialFile(");
    expect(roleEnvironment).toContain("readPrivateCredentialFile(");
    expect(roleEnvironment).toContain("assertPrivateCredentialDirectory(");
    expect(dockerfile.match(/credential-file-guard\.mjs/g)).toHaveLength(4);
    for (const entrypoint of [deploy, rootStart]) {
      expect(entrypoint).toContain("umask 077");
      expect(entrypoint).toContain("assert_private_env_file");
      expect(entrypoint).toContain("credential-file-guard.mjs");
    }
    const rootWrite = rootStart.slice(
      rootStart.indexOf("write_env_value() {"),
      rootStart.indexOf("ensure_generated_secret() {"),
    );
    expect(rootWrite).toContain(
      'node "$CREDENTIAL_FILE_GUARD_SCRIPT" env-set "$ENV_FILE" "$name"',
    );
    expect(credentialFileGuard).toContain("constants.O_CREAT | constants.O_EXCL");
    expect(credentialFileGuard.indexOf("fsyncSync(temporaryDescriptor)")).toBeLessThan(
      credentialFileGuard.indexOf("renameSync(temporaryPath, path)"),
    );
    expect(credentialFileGuard.indexOf("renameSync(temporaryPath, path)")).toBeLessThan(
      credentialFileGuard.indexOf("fsyncSync(directoryDescriptor)"),
    );
    const rootValidation = rootStart.slice(
      rootStart.indexOf("validate_env() {"),
      rootStart.indexOf("ensure_network() {"),
    );
    expect(rootValidation.indexOf("require_env_file")).toBeLessThan(
      rootValidation.indexOf("ensure_generated_secrets"),
    );
    expect(rootStart).toContain(
      "ensure_generated_secret PAYMENT_RECONCILIATION_SECRET",
    );
    const deployInit = deploy.slice(
      deploy.indexOf("init() {"),
      deploy.indexOf("require_env() {"),
    );
    expect(deployInit).toContain('[ -e "$ENV_FILE" ] || [ -L "$ENV_FILE" ]');
    expect(deployInit.indexOf("assert_private_env_file")).toBeLessThan(
      deployInit.indexOf('cp "$ENV_EXAMPLE" "$ENV_FILE"'),
    );
    const configure = deploy.slice(
      deploy.indexOf("configure() {"),
      deploy.indexOf("assert_required_env() {"),
    );
    expect(configure).toMatch(/"\$editor" "\$ENV_FILE"\s+assert_private_env_file/);
    expect(deploy).toContain("migrate) migrate_only");
  });
});
