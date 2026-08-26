import {
  chmodSync,
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

const script = readFileSync("deploy/prod/zero-downtime-app.sh", "utf8");
const deployScript = readFileSync("deploy.sh", "utf8");
const runbook = readFileSync(
  "deploy/prod/zero-downtime-production-runbook.md",
  "utf8",
);
const posixShell = process.platform === "win32"
  ? ["C:/Program Files/Git/bin/sh.exe", "C:/Program Files/Git/usr/bin/sh.exe"]
      .find((candidate) => existsSync(candidate))
  : "sh";
const shellIntegrationTimeout = process.platform === "win32" ? 45_000 : 15_000;

function shellFunctionFrom(source: string, name: string) {
  const start = source.indexOf(`${name}() {`);
  expect(start, `${name} must exist`).toBeGreaterThanOrEqual(0);
  const bodyStart = source.indexOf("\n", start) + 1;
  const nextFunction = source.slice(bodyStart).search(/^\w+\(\) \{/m);
  return nextFunction < 0
    ? source.slice(start)
    : source.slice(start, bodyStart + nextFunction);
}

function shellFunction(name: string) {
  return shellFunctionFrom(script, name);
}

function shellSubshellFunction(name: string) {
  const start = script.indexOf(`${name}() (`);
  expect(start, `${name} subshell function must exist`).toBeGreaterThanOrEqual(0);
  const end = script.indexOf("\n)\n", start);
  expect(end, `${name} subshell function must terminate`).toBeGreaterThan(start);
  return script.slice(start, end + 3);
}

function sha256(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

function runRollbackImageResolver({
  appRole = "",
  migrationRole = "",
  previousAppMatches = true,
}: {
  appRole?: string;
  migrationRole?: string;
  previousAppMatches?: boolean;
}) {
  const appImage = `sha256:${"a".repeat(64)}`;
  const migrationImage = `sha256:${"b".repeat(64)}`;
  const previousApp = previousAppMatches
    ? appImage
    : `sha256:${"c".repeat(64)}`;
  const harness = `
set -eu
${shellFunction("fail")}
${shellFunction("validate_image_id")}
${shellFunction("resolve_local_image_id")}
${shellFunction("image_role_label")}
${shellFunction("resolve_rollback_image_references")}
APP_IMAGE=${appImage}
MIGRATION_IMAGE=${migrationImage}
PREVIOUS_APP_IMAGE=${previousApp}
docker() {
  [ "$1" = image ] && [ "$2" = inspect ] && [ "$3" = --format ] || return 91
  case "$4" in
    '{{.Id}}')
      case "$5" in
        rollback-app) printf '%s\\n' "$APP_IMAGE" ;;
        rollback-migration) printf '%s\\n' "$MIGRATION_IMAGE" ;;
        *) return 92 ;;
      esac
      ;;
    *io.clean-pay.role*)
      case "$5" in
        "$APP_IMAGE") printf '%s\\n' "\${MOCK_APP_ROLE:-}" ;;
        "$MIGRATION_IMAGE") printf '%s\\n' "\${MOCK_MIGRATION_ROLE:-}" ;;
        *) return 93 ;;
      esac
      ;;
    *) return 94 ;;
  esac
}
resolve_rollback_image_references rollback-app rollback-migration
printf 'mode=%s\\napp=%s\\nmigration=%s\\n' \\
  "$ROLLBACK_IMAGE_MODE" \\
  "$RESOLVED_ROLLBACK_APP_IMAGE" \\
  "$RESOLVED_ROLLBACK_MIGRATION_IMAGE"
`;

  return spawnSync(posixShell!, ["-c", harness], {
    cwd: process.cwd(),
    encoding: "utf8",
    env: {
      NODE_ENV: "test",
      PATH: process.env.PATH ?? "",
      MOCK_APP_ROLE: appRole,
      MOCK_MIGRATION_ROLE: migrationRole,
    },
  });
}

const validProductionEnv: Record<string, string> = {
  CLEAN_PAY_DEPLOY_SOURCE: "build",
  CLEAN_PAY_IMAGE: "clean-pay-prod-app:old",
  CLEAN_PAY_MIGRATION_IMAGE: "clean-pay-prod-migration:old",
  CLEAN_PAY_RELEASE: "release-old",
  CLEAN_PAY_REVISION: "a".repeat(40),
  POSTGRES_DB: "clean_pay",
  POSTGRES_USER: "clean_pay_bootstrap",
  POSTGRES_PASSWORD: "pg-zdt-9QvL2xR8mT4pK7sN6cWd", // gitleaks:allow -- synthetic validator fixture
  DATABASE_URL:
    "postgresql://clean_pay_app:db-app-zdt-7Vr3Nm8Wp2Kq5Xs9Lc4D@postgres:5432/clean_pay?schema=public",
  MIGRATION_DATABASE_URL:
    "postgresql://clean_pay_migration:db-migration-zdt-4Qp8Xs2Ln7Vr5Km9Wc3H@postgres:5432/clean_pay?schema=public",
  RETENTION_DATABASE_URL:
    "postgresql://clean_pay_retention:db-retention-zdt-6Wm3Kq9Vr2Xs8Lc5Np7H@postgres:5432/clean_pay?schema=public",
  HOLD_OPERATOR_DATABASE_URL:
    "postgresql://clean_pay_hold:db-hold-zdt-9Vr4Kp7Xs2Lm8Nc5Qw3H@postgres:5432/clean_pay?schema=public",
  CLEAN_PAY_DATABASE_ADOPT_EXISTING: "false",
  CLEAN_PAY_DATABASE_ADOPTION_BACKUP_CONFIRMED: "false",
  REDIS_URL: "redis://redis:6379/0",
  APP_URL: "https://pay.clean-pay.dev",
  NEXT_PUBLIC_APP_URL: "https://pay.clean-pay.dev",
  REMNASHOP_API_BASE_URL: "http://remnashop:5000/api/v1/public",
  REMNASHOP_ADMIN_API_BASE_URL: "http://remnashop:5000/api/v1/admin",
  REMNASHOP_API_KEY: "shop-zdt-8Wp4Jz7Lc2Nq9Vr5Ks3M",
  REMNASHOP_AUTH_SERVICE_KEY: "auth-zdt-7Vr3Nm8Wp2Kq5Xs9Lc4D",
  REMNAWAVE_API_BASE_URL: "https://panel.clean-pay.dev",
  REMNAWAVE_TOKEN: "wave-zdt-7Nq3Kp9Xs4Vm2Lc8Wr6J",
  REMNAWAVE_SUBSCRIPTION_ORIGINS: "https://subscription.clean-pay.dev",
  WEB_JWT_SECRET: "jwt-zdt-6Vr2Kp8Wm4Xq9Lc3Ns7D5Hz1", // gitleaks:allow -- synthetic validator fixture
  WEB_REFRESH_SECRET: "refresh-zdt-5Kq8Vr2Nm7Wp4Lc9Xs3D6Hz1",
  AUDIT_IP_HASH_SECRET: "audit-zdt-4Wp7Kq2Vr9Nm5Xs8Lc3D6Hz1",
  TRUSTED_PROXY_HOPS: "1",
  RATE_LIMIT_IDENTITY_SECRET: "rate-zdt-7Xs2Lc8Nm4Wp9Kq5Vr3D6Hz1", // gitleaks:allow -- synthetic validator fixture
  AUTH_RATE_LIMIT_CAPACITY: "1000",
  AUTH_CONCURRENCY_LIMIT: "64",
  READINESS_INTERNAL_SECRET: "ready-zdt-5Vr8Xs3Lc7Nm4Wp9Kq2D6Hz1",
  TELEGRAM_OIDC_ISSUER: "https://oauth.telegram.org",
  TELEGRAM_OIDC_AUTHORIZATION_ENDPOINT: "https://oauth.telegram.org/auth",
  TELEGRAM_OIDC_TOKEN_ENDPOINT: "https://oauth.telegram.org/token",
  TELEGRAM_OIDC_JWKS_URI: "https://oauth.telegram.org/.well-known/jwks.json",
  TELEGRAM_OIDC_CLIENT_ID: "7654321098",
  TELEGRAM_OIDC_CLIENT_SECRET: "oidc-zdt-3Nm8Wp5Kq2Vr7Xs9Lc4D6Hz1", // gitleaks:allow -- synthetic validator fixture
  TELEGRAM_BOT_TOKEN: "7654321098:BotTokenZdtOnly_9QvL2xR8mT4p",
  COOKIE_SECURE: "true",
  COOKIE_SAMESITE: "lax",
  TURNSTILE_ENABLED: "true",
  TURNSTILE_SITE_KEY: "0x4AAAAAZdtOnlySiteKey8Wp4Jz7Lc2",
  TURNSTILE_SECRET_KEY: "turnstile-zdt-8Xs3Lc7Nm4Wp9Kq5Vr2D6Hz1", // gitleaks:allow -- synthetic validator fixture
  TURNSTILE_VERIFY_URL:
    "https://challenges.cloudflare.com/turnstile/v0/siteverify",
  SUPPORT_ENABLED: "false",
  SUPPORT_EMAIL: "",
  SUPPORT_TELEGRAM_USERNAME: "",
  SUPPORT_FAQ_URL: "",
  CHATWOOT_BASE_URL: "",
  CHATWOOT_WEBSITE_TOKEN: "",
  CHATWOOT_HMAC_TOKEN: "",
  PAYMENT_RECONCILIATION_ENABLED: "false",
  PAYMENT_RECONCILIATION_SECRET: "",
  PAYMENT_RECONCILIATION_BATCH_SIZE: "10",
  PAYMENT_RECONCILIATION_INTERVAL_SECONDS: "30",
  PAYMENT_RECONCILIATION_INTERNAL_URL:
    "http://app:4000/api/internal/payments/reconcile",
  PAYMENT_REDIRECT_ORIGINS: "https://yoomoney.ru,https://pay.platega.io",
  CLEAN_PAY_READINESS_MAILPIT_URL: "http://mailpit:8025",
  CLEAN_PAY_READINESS_REMNAWAVE_URL: "https://panel.clean-pay.dev",
  NEXT_PUBLIC_BRAND_NAME: "Clean Pay",
  NEXT_PUBLIC_BRAND_LOGO_URL: "/clean-pay-logo.png",
  CLEAN_PAY_BIND: "127.0.0.1",
  CLEAN_PAY_PORT: "4000",
};

function productionEnvContent(overrides: Record<string, string> = {}) {
  return (
    Object.entries({ ...validProductionEnv, ...overrides })
      .map(([name, value]) => name + "=" + value)
      .join("\n") + "\n"
  );
}

describe("guarded zero-downtime application rollout", () => {
  it.skipIf(!posixShell)("has valid shell syntax and a side-effect-free help command", () => {
    const syntax = spawnSync(posixShell!, ["-n", "deploy/prod/zero-downtime-app.sh"], {
      cwd: process.cwd(),
      encoding: "utf8",
    });
    expect(syntax.status, syntax.stderr).toBe(0);

    const help = spawnSync(posixShell!, ["deploy/prod/zero-downtime-app.sh", "help"], {
      cwd: process.cwd(),
      encoding: "utf8",
      env: { NODE_ENV: "test", PATH: process.env.PATH ?? "" },
    });
    expect(help.status, help.stderr).toBe(0);
    expect(help.stdout).toContain("--require-no-pending-migrations");
    expect(help.stdout).toContain("--traffic-on-canary");
    expect(help.stdout).toContain("--traffic-off-canary");
  });

  it.skipIf(!posixShell)("provides a build-only preparation command without runtime or schema mutation", () => {
    const syntax = spawnSync(posixShell!, ["-n", "deploy.sh"], {
      cwd: process.cwd(),
      encoding: "utf8",
    });
    expect(syntax.status, syntax.stderr).toBe(0);

    const help = spawnSync(posixShell!, ["deploy.sh", "help"], {
      cwd: process.cwd(),
      encoding: "utf8",
      env: { NODE_ENV: "test", PATH: process.env.PATH ?? "" },
    });
    expect(help.status, help.stderr).toBe(0);
    expect(help.stdout).toContain("build");

    const buildOnly = shellFunctionFrom(deployScript, "build_images_only");
    expect(buildOnly.indexOf("prepare_compose")).toBeLessThan(
      buildOnly.indexOf("prepare_images"),
    );
    expect(buildOnly.indexOf("prepare_images")).toBeLessThan(
      buildOnly.indexOf("preflight_images"),
    );
    expect(buildOnly).not.toMatch(/\b(?:compose\s+(?:stop|down|up|run)|migrate)\b/);
    expect(deployScript).toContain("build) build_images_only ;;");
  });

  it("refuses schema changes instead of disguising the maintenance deploy as zero-downtime", () => {
    const migrationGuard = shellFunction("assert_no_pending_migrations");
    const stage = shellFunction("stage_canary");

    expect(migrationGuard).toContain("migrate status");
    expect(migrationGuard).toContain("pending, failed, or divergent Prisma migrations block");
    expect(stage).toContain('--require-no-pending-migrations');
    expect(script).not.toContain("migrate deploy");
    expect(script).not.toContain("db push");
    expect(script).not.toMatch(/\bcompose\s+(?:stop|down)\b/);
    expect(script).not.toContain("./deploy.sh install");
  });

  it("preserves its reviewed Compose path while scrubbing Compose control variables", () => {
    const compose = shellSubshellFunction("compose");
    const unsetCommand = compose.indexOf("\n  unset \\");

    expect(compose.indexOf("compose_path=$COMPOSE_FILE")).toBeLessThan(
      unsetCommand,
    );
    expect(compose).toContain('-f "$compose_path"');
    expect(compose).not.toContain('-f "$COMPOSE_FILE"');
  });

  it("keeps the old exact Compose app and workers healthy until a separate canary is ready", () => {
    const stage = shellFunction("stage_canary");

    expect(stage.indexOf("assert_compose_service app")).toBeLessThan(
      stage.indexOf("docker create"),
    );
    expect(stage.indexOf('assert_compose_stack_image "$PREVIOUS_APP_IMAGE"')).toBeLessThan(
      stage.indexOf("docker create"),
    );
    expect(stage.indexOf("assert_no_pending_migrations")).toBeLessThan(
      stage.indexOf("docker create"),
    );
    expect(stage.indexOf("docker create")).toBeLessThan(
      stage.indexOf("wait_for_canary_readiness"),
    );
    expect(stage.indexOf("wait_for_canary_readiness")).toBeLessThan(
      stage.indexOf("write_state false"),
    );
    expect(stage).toContain('"$TARGET_APP_IMAGE" >/dev/null');
    expect(stage).toContain("container $CANARY_NAME already exists");
  });

  it.skipIf(!posixShell)("accepts only an exact label-less legacy rollback pair", () => {
    const legacy = runRollbackImageResolver({});
    expect(legacy.status, legacy.stderr).toBe(0);
    expect(legacy.stdout).toContain("mode=legacy");
    expect(legacy.stdout).toContain(`app=sha256:${"a".repeat(64)}`);
    expect(legacy.stdout).toContain(`migration=sha256:${"b".repeat(64)}`);

    const modern = runRollbackImageResolver({
      appRole: "app",
      migrationRole: "migration",
    });
    expect(modern.status, modern.stderr).toBe(0);
    expect(modern.stdout).toContain("mode=strict");

    for (const rejected of [
      runRollbackImageResolver({ appRole: "app" }),
      runRollbackImageResolver({ appRole: "worker", migrationRole: "migration" }),
    ]) {
      expect(rejected.status).not.toBe(0);
      expect(rejected.stderr).toContain(
        "rollback images have partial or invalid io.clean-pay.role metadata",
      );
    }

    const mismatch = runRollbackImageResolver({ previousAppMatches: false });
    expect(mismatch.status).not.toBe(0);
    expect(mismatch.stderr).toContain(
      "legacy rollback application image does not match the running Compose image",
    );
  }, shellIntegrationTimeout);

  it("keeps modern target and rollback image pairs under strict provenance preflight", () => {
    const target = shellFunction("preflight_target_images");
    const rollback = shellFunction("preflight_rollback_images");
    const resolver = shellFunction("resolve_rollback_image_references");
    const legacyValidator = shellFunction("validate_legacy_rollback_environment");

    expect(target).toContain('preflight_image_pair "$ENV_FILE"');
    expect(resolver).toContain("app:migration");
    expect(resolver).toContain("ROLLBACK_IMAGE_MODE=strict");
    expect(resolver).toContain("ROLLBACK_IMAGE_MODE=legacy");
    expect(rollback).toContain('if [ "$ROLLBACK_IMAGE_MODE" = "strict" ]');
    expect(rollback).toContain('preflight_image_pair "$ROLLBACK_ENV_FILE"');
    expect(rollback).toContain("reference changed during preflight");
    expect(rollback).toContain("validate_legacy_rollback_environment");
    expect(legacyValidator).toContain("--pull never");
    expect(legacyValidator).toContain("--network none");
    expect(legacyValidator).toContain("--read-only");
    expect(legacyValidator).toContain("--cap-drop ALL");
    expect(legacyValidator).toContain("--security-opt no-new-privileges");
    expect(legacyValidator).toContain("--user 0:0");
    expect(legacyValidator).toContain("readonly");
    expect(legacyValidator).toContain("--env-file /run/clean-pay-rollback.env");
    expect(legacyValidator).toContain(">/dev/null 2>&1");
    expect(legacyValidator).not.toContain("--network host");
  });

  it("derives the private network from exact Compose labels and reserves a unique edge alias", () => {
    const serviceGuard = shellFunction("assert_compose_service");
    const networkDiscovery = shellFunction("discover_internal_network");
    const aliasGuard = shellFunction("validate_alias");
    const stage = shellFunction("stage_canary");

    expect(serviceGuard).toContain("com.docker.compose.project");
    expect(serviceGuard).toContain("com.docker.compose.service");
    expect(serviceGuard).toContain("com.docker.compose.oneoff");
    expect(serviceGuard).toContain('"${PROJECT_NAME}-${service}-1"');
    expect(networkDiscovery).toContain("com.docker.compose.network");
    expect(networkDiscovery).toContain('"default"');
    expect(networkDiscovery).toContain("old application is not attached");
    expect(aliasGuard).toContain("clean-pay|app|postgres|redis");
    expect(stage).toContain('docker network connect --alias "$CANARY_ALIAS"');
    expect(stage).toContain("--restart unless-stopped");
    const canaryTopology = shellFunction("assert_canary_topology");
    expect(canaryTopology).toContain("HostConfig.RestartPolicy.Name");
    expect(canaryTopology).toContain('restart_policy" = "unless-stopped');
    expect(canaryTopology).toContain(
      'canary has the production clean-pay alias before traffic switch',
    );
  });

  it("keeps secrets out of arguments and validates readiness from inside the canary", () => {
    const readiness = shellFunction("wait_for_canary_readiness");
    const stage = shellFunction("stage_canary");

    expect(readiness).toContain("process.env.READINESS_INTERNAL_SECRET");
    expect(readiness).toContain("docker exec \"$CANARY_NAME\" node -e");
    expect(readiness).toContain("checks.length>0");
    expect(readiness).toContain("!Array.isArray(body.checks)");
    expect(readiness).toContain("check.status==='ok'");
    expect(readiness).not.toContain("$(env_value READINESS_INTERNAL_SECRET");
    expect(stage).toContain('--env-file "$APP_ENV_FILE"');
    expect(stage).not.toMatch(/--env\s+READINESS_INTERNAL_SECRET/);
    expect(script).not.toMatch(/printf[^\n]*READINESS_INTERNAL_SECRET/);
  });

  it("gives the canary and migration assertion explicit roles and runtime hardening", () => {
    const stage = shellFunction("stage_canary");
    const migrationGuard = shellFunction("assert_no_pending_migrations");

    for (const flag of [
      "--read-only",
      "--cap-drop ALL",
      "--security-opt no-new-privileges",
      "--pids-limit 256",
      "--memory 1g",
      "--cpus 1.0",
      "--tmpfs /tmp:rw,noexec,nosuid,nodev,size=64m,mode=1777",
      "--tmpfs /app/.next/cache:rw,noexec,nosuid,nodev,size=128m,mode=0700,uid=1001,gid=1001",
      "--env CLEAN_PAY_RUNTIME_ROLE=application",
    ]) {
      expect(stage).toContain(flag);
    }
    for (const flag of [
      "--read-only",
      "--cap-drop ALL",
      "--security-opt no-new-privileges",
      "--pids-limit 128",
      "--memory 1g",
      "--cpus 1.0",
      "--tmpfs /tmp:rw,noexec,nosuid,nodev,size=64m,mode=1777",
      "--env CLEAN_PAY_RUNTIME_ROLE=migration",
    ]) {
      expect(migrationGuard).toContain(flag);
    }
    expect(migrationGuard).toContain("node deploy/prod/validate-env.mjs");
  });

  it("uses private atomic state and removes only a label-owned exact canary", () => {
    const writeState = shellFunction("write_state");
    const loadState = shellFunction("load_state");
    const removal = shellFunction("remove_owned_canary");

    expect(writeState).toContain("umask 077");
    expect(writeState).toContain('chmod 600 "$state_temp"');
    expect(writeState).toContain('mv "$state_temp" "$STATE_FILE"');
    expect(loadState).toContain("permissions must be exactly 600");
    expect(loadState).toContain("must be owned by the current operator");
    expect(script).not.toMatch(/(?:^|\n)\s*(?:source|\.)\s+["']?\$STATE_FILE/m);
    expect(removal).toContain("assert_owned_canary_identity");
    expect(script).toContain("io.clean-pay.zero-downtime.owner");
    expect(removal).toContain('docker rm -f "$container_name"');
    expect(script).not.toMatch(/\brm\s+(?:-[^\s]*r[^\s]*|--recursive)\b/);
    expect(script).not.toMatch(/\bdocker\s+(?:volume|system)\s+(?:rm|remove|prune)\b/);
  });

  it("promotes only behind acknowledged canary traffic and restores runtime plus authoritative env", () => {
    const promotion = shellFunction("promote_compose");
    const rollback = shellFunction("rollback_compose");
    const exitTrap = shellFunction("on_exit");

    expect(promotion).toContain('--traffic-on-canary');
    expect(promotion.indexOf("assert_canary_topology")).toBeLessThan(
      promotion.indexOf("compose up"),
    );
    expect(promotion.indexOf("wait_for_canary_readiness")).toBeLessThan(
      promotion.indexOf("compose up"),
    );
    expect(promotion).toContain("rollback_compose_on_failure=1");
    expect(promotion.indexOf("write_state true")).toBeLessThan(
      promotion.indexOf("rollback_compose_on_failure=0"),
    );
    expect(exitTrap).toContain("restore_previous_compose");
    expect(exitTrap).not.toContain("cleanup_canary_on_failure=1");
    expect(rollback).toContain('--traffic-on-canary');
    expect(shellFunction("remove_canary")).toContain('--traffic-off-canary');
    const restore = shellFunction("restore_previous_compose");
    expect(restore).toContain("TARGET_APP_IMAGE=$PREVIOUS_APP_IMAGE");
    expect(restore).toContain("TARGET_MIGRATION_IMAGE=$PREVIOUS_MIGRATION_IMAGE");
    expect(restore).toContain(
      'node "$ENV_GUARD_SCRIPT" restore-images "$ENV_FILE" "$ROLLBACK_ENV_FILE"',
    );
    expect(shellFunction("preflight_rollback_images")).toContain(
      'rollback env application image does not match the running Compose image',
    );
    expect(shellFunction("write_state")).toContain("PREVIOUS_MIGRATION_IMAGE");
    expect(shellFunction("write_state")).toContain("ROLLBACK_ENV_FILE");
    expect(script).not.toContain("caddy reload");
  });

  it("allows only image metadata drift and atomically restores the rollback env pair", () => {
    const directory = mkdtempSync(path.join(tmpdir(), "clean-pay-env-zdt-"));
    const current = path.join(directory, "current.env");
    const rollback = path.join(directory, "rollback.env");
    const targetContent = productionEnvContent({
      CLEAN_PAY_IMAGE: "clean-pay-prod-app:target",
      CLEAN_PAY_MIGRATION_IMAGE: "clean-pay-prod-migration:target",
      CLEAN_PAY_RELEASE: "release-target",
      CLEAN_PAY_REVISION: "b".repeat(40),
    });
    const rollbackContent = productionEnvContent();

    try {
      writeFileSync(current, targetContent, { mode: 0o600 });
      writeFileSync(rollback, rollbackContent, { mode: 0o600 });
      chmodSync(current, 0o600);
      chmodSync(rollback, 0o600);

      const verify = spawnSync(
        process.execPath,
        ["deploy/prod/zero-downtime-env.mjs", "verify", current, rollback],
        { cwd: process.cwd(), encoding: "utf8" },
      );
      expect(verify.status, verify.stderr).toBe(0);

      const restore = spawnSync(
        process.execPath,
        [
          "deploy/prod/zero-downtime-env.mjs",
          "restore-images",
          current,
          rollback,
        ],
        { cwd: process.cwd(), encoding: "utf8" },
      );
      expect(restore.status, restore.stderr).toBe(0);
      expect(readFileSync(current, "utf8")).toBe(rollbackContent);

      writeFileSync(
        current,
        productionEnvContent({
          CLEAN_PAY_IMAGE: "clean-pay-prod-app:target",
          CLEAN_PAY_MIGRATION_IMAGE: "clean-pay-prod-migration:target",
          CLEAN_PAY_RELEASE: "release-target",
          CLEAN_PAY_REVISION: "b".repeat(40),
          AUTH_RATE_LIMIT_CAPACITY: "999",
        }),
        { mode: 0o600 },
      );
      chmodSync(current, 0o600);
      const unrelatedDrift = spawnSync(
        process.execPath,
        ["deploy/prod/zero-downtime-env.mjs", "verify", current, rollback],
        { cwd: process.cwd(), encoding: "utf8" },
      );
      expect(unrelatedDrift.status).not.toBe(0);
      expect(unrelatedDrift.stderr).toContain(
        "AUTH_RATE_LIMIT_CAPACITY differs; only the five image/release settings may change",
      );
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it("writes and restores Caddy bytes without replacing the bind-mounted inode", () => {
    const directory = mkdtempSync(path.join(tmpdir(), "clean-pay-caddy-zdt-"));
    const authoritative = path.join(directory, "Caddyfile");
    const primary = path.join(directory, "Caddyfile.primary");
    const candidate = path.join(directory, "Caddyfile.canary");
    const primaryContents = "example.test { reverse_proxy clean-pay:4000 }\n";
    const candidateContents =
      "example.test { reverse_proxy clean-pay-canary:4000 }\n";

    try {
      writeFileSync(authoritative, primaryContents);
      writeFileSync(primary, primaryContents);
      writeFileSync(candidate, candidateContents);
      const inode = statSync(authoritative).ino;

      const replace = spawnSync(
        process.execPath,
        [
          "deploy/prod/caddyfile-same-inode.mjs",
          "replace",
          authoritative,
          candidate,
          sha256(primaryContents),
          sha256(candidateContents),
        ],
        { cwd: process.cwd(), encoding: "utf8" },
      );
      expect(replace.status, replace.stderr).toBe(0);
      expect(readFileSync(authoritative, "utf8")).toBe(candidateContents);
      expect(statSync(authoritative).ino).toBe(inode);

      const staleWrite = spawnSync(
        process.execPath,
        [
          "deploy/prod/caddyfile-same-inode.mjs",
          "replace",
          authoritative,
          primary,
          sha256("not-the-current-file"),
          sha256(primaryContents),
        ],
        { cwd: process.cwd(), encoding: "utf8" },
      );
      expect(staleWrite.status).not.toBe(0);
      expect(staleWrite.stderr).toContain("checksum does not match");
      expect(readFileSync(authoritative, "utf8")).toBe(candidateContents);

      const restore = spawnSync(
        process.execPath,
        [
          "deploy/prod/caddyfile-same-inode.mjs",
          "restore",
          authoritative,
          primary,
          sha256(primaryContents),
        ],
        { cwd: process.cwd(), encoding: "utf8" },
      );
      expect(restore.status, restore.stderr).toBe(0);
      expect(readFileSync(authoritative, "utf8")).toBe(primaryContents);
      expect(statSync(authoritative).ino).toBe(inode);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it.skipIf(!posixShell)("keeps every production runbook shell block syntactically valid", () => {
    const blocks = [...runbook.matchAll(/```bash\n([\s\S]*?)```/g)].map(
      (match) => match[1] ?? "",
    );
    expect(blocks.length).toBeGreaterThanOrEqual(7);
    for (const [index, block] of blocks.entries()) {
      const syntax = spawnSync(posixShell!, ["-n", "-c", block], {
        cwd: process.cwd(),
        encoding: "utf8",
      });
      expect(syntax.status, `runbook block ${index + 1}: ${syntax.stderr}`).toBe(0);
    }
  });

  it("documents a restart-durable same-inode Caddy switch and preserves the advertiser route", () => {
    expect(runbook).toContain("REPLACE_WITH_ABSOLUTE_RELEASE_ROOT");
    expect(runbook).toContain("REPLACE_WITH_ABSOLUTE_CURRENT_ENV_FILE");
    expect(runbook).toContain("REPLACE_WITH_ABSOLUTE_HOST_CADDYFILE");
    expect(runbook).toContain("REPLACE_WITH_ABSOLUTE_PRIVATE_CADDY_STATE_ROOT");
    expect(runbook).toContain('test "$caddy_mount" = "bind|$caddy_host|false"');
    expect(runbook).toContain("caddy_host_inode=$(stat -c '%d:%i' \"$caddy_host\")");
    expect(runbook).toContain(
      'test "$caddy_bound_inode" = "$caddy_host_inode"',
    );
    expect(runbook).toContain("stale deleted file-bind inode");
    expect(runbook).toContain('test "$caddy_bound_sha" = "$caddy_host_sha"');
    expect(runbook).toContain("/etc/caddy/Caddyfile");
    expect(runbook).toContain("reverse_proxy clean-pay:4000");
    expect(runbook).toContain("reverse_proxy clean-pay-canary:4000");
    expect(runbook).toContain("reverse_proxy clean-pay-advertiser-cabinet:4100");
    expect(runbook).toContain("caddyfile-same-inode.mjs");
    expect(runbook).toContain('stat -c \'%d:%i\' "$caddy_host"');
    expect(runbook).toContain('sha256sum "$caddy_host"');
    expect(
      runbook.match(
        /docker exec "\$caddy_container" sha256sum \/etc\/caddy\/Caddyfile/g,
      )?.length ?? 0,
    ).toBeGreaterThanOrEqual(4);
    expect(runbook).toContain('restore "$caddy_host" "$caddy_backup"');
    expect(runbook).toContain('restore "$caddy_host" "$caddy_candidate"');
    expect(runbook).toContain("caddy validate --config /tmp/Caddyfile-clean-pay-primary");
    expect(runbook).toContain("caddy validate --config /tmp/Caddyfile-clean-pay-canary");
    expect(runbook).toContain("caddy reload --config /etc/caddy/Caddyfile");
    expect(runbook).not.toContain("caddy reload --config /tmp/Caddyfile-clean-pay-canary");
    expect(runbook).toContain("Любая pending, failed или");
    expect(runbook).toContain("`migrate deploy`, `db push`");
    expect(runbook).toContain("revision `0058`");
    expect(runbook).not.toContain("revision `0057`");
    for (const privateLiteral of [
      "host2",
      "2.8 GiB",
      "/opt/clean-pay",
      "/opt/remnawave",
    ]) {
      expect(runbook).not.toContain(privateLiteral);
    }
  });
});
