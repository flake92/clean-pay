import {
  chmodSync,
  mkdtempSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { initializeDatabaseCredentials } from "../../../deploy/prod/database-credential-init.mjs";
import {
  assertV011UpgradePreparationNotRequired,
  prepareV011ProductionEnvironment,
} from "../../../deploy/prod/production-environment-upgrade.mjs";
import {
  parseProductionEnvironmentFile,
  validateProductionEnvironment,
} from "../../../runtime/production-env-rules.mjs";

const temporaryDirectories: string[] = [];

function legacyEnvironment() {
  const bootstrapPassword = "legacy-db-7Qm2Vs8Kp4Nc9Lw6Xr3D5Hz1";
  return [
    "COMPOSE_PROJECT_NAME=clean-pay-prod",
    "CLEAN_PAY_MIN_FREE_DISK_MB=8192",
    "CLEAN_PAY_IMAGE=clean-pay-prod-app:local",
    "CLEAN_PAY_BIND=127.0.0.1",
    "CLEAN_PAY_PORT=4000",
    "CLEAN_PAY_EDGE_NETWORK=remnawave-network",
    "POSTGRES_DB=clean_pay",
    "POSTGRES_USER=clean_pay",
    `POSTGRES_PASSWORD=${bootstrapPassword}`,
    `DATABASE_URL=postgresql://clean_pay:${bootstrapPassword}@postgres:5432/clean_pay?schema=public`,
    "REDIS_URL=redis://redis:6379/0",
    "APP_URL=https://pay.clean-pay.dev",
    "NEXT_PUBLIC_APP_URL=https://pay.clean-pay.dev",
    "NEXT_PUBLIC_BRAND_NAME=Clean Pay",
    "NEXT_PUBLIC_BRAND_LOGO_URL=/clean-pay-logo.png",
    "LOG_LEVEL=info",
    "AUTH_STATE_RETENTION_DAYS=7",
    "SESSION_RETENTION_DAYS=90",
    "AUDIT_INFO_RETENTION_DAYS=180",
    "AUDIT_SECURITY_RETENTION_DAYS=365",
    "RATE_LIMIT_RETENTION_DAYS=30",
    "DATA_RETENTION_INTERVAL_SECONDS=21600",
    "REMNASHOP_API_BASE_URL=http://remnashop:5000/api/v1/public",
    "REMNASHOP_ADMIN_API_BASE_URL=http://remnashop:5000/api/v1/admin",
    "REMNASHOP_API_KEY=legacy-shop-8Wp4Jz7Lc2Nq9Vr5Ks3M",
    "REMNASHOP_AUTH_SERVICE_KEY=legacy-auth-7Vr3Nm8Wp2Kq5Xs9Lc4D",
    "REMNASHOP_API_CONTAINER=remnashop",
    "REMNASHOP_WORKER_CONTAINER=remnashop-taskiq-worker",
    "REMNASHOP_SCHEDULER_CONTAINER=remnashop-taskiq-scheduler",
    "REMNASHOP_POSTGRES_CONTAINER=remnashop-db",
    "REMNASHOP_MINIMUM_ALEMBIC_REVISION=0050",
    "PAYMENT_RECONCILIATION_ENABLED=true",
    "PAYMENT_RECONCILIATION_SECRET=legacy-reconcile-2Lc7Nm4Wp9Kq5Vr8Xs3D6Hz1",
    "PAYMENT_RECONCILIATION_BATCH_SIZE=10",
    "PAYMENT_RECONCILIATION_INTERVAL_SECONDS=30",
    "PAYMENT_RECONCILIATION_INTERNAL_URL=http://app:4000/api/internal/payments/reconcile",
    "REMNAWAVE_API_BASE_URL=https://panel.clean-pay.dev",
    "REMNAWAVE_TOKEN=legacy-wave-7Nq3Kp9Xs4Vm2Lc8Wr6J",
    "WEB_JWT_SECRET=legacy-jwt-6Vr2Kp8Wm4Xq9Lc3Ns7D5Hz1",
    "WEB_REFRESH_SECRET=legacy-refresh-5Kq8Vr2Nm7Wp4Lc9Xs3D6Hz1",
    "AUDIT_IP_HASH_SECRET=legacy-audit-4Wp7Kq2Vr9Nm5Xs8Lc3D6Hz1",
    "TRUSTED_PROXY_HOPS=1",
    "RATE_LIMIT_IDENTITY_SECRET=legacy-rate-7Xs2Lc8Nm4Wp9Kq5Vr3D6Hz1",
    "AUTH_RATE_LIMIT_CAPACITY=1000",
    "AUTH_CONCURRENCY_LIMIT=64",
    "READINESS_INTERNAL_SECRET=legacy-ready-5Vr8Xs3Lc7Nm4Wp9Kq2D6Hz1",
    "COOKIE_SECURE=true",
    "COOKIE_SAMESITE=lax",
    "TELEGRAM_OIDC_CLIENT_ID=7654321098",
    "TELEGRAM_OIDC_CLIENT_SECRET=legacy-oidc-3Nm8Wp5Kq2Vr7Xs9Lc4D6Hz1",
    "TELEGRAM_BOT_TOKEN=7654321098:LegacyBotToken_9QvL2xR8mT4p",
    "TURNSTILE_ENABLED=true",
    "TURNSTILE_SITE_KEY=0x4AAAAALegacySiteKey8Wp4Jz7Lc2",
    "TURNSTILE_SECRET_KEY=legacy-turnstile-8Xs3Lc7Nm4Wp9Kq5Vr2D6Hz1",
    "TURNSTILE_VERIFY_URL=https://challenges.cloudflare.com/turnstile/v0/siteverify",
    "SUPPORT_ENABLED=false",
    "SUPPORT_EMAIL=",
    "SUPPORT_TELEGRAM_USERNAME=",
    "SUPPORT_FAQ_URL=",
    "CLEAN_PAY_READINESS_MAILPIT_URL=",
    "CLEAN_PAY_READINESS_REMNAWAVE_URL=",
    "",
  ].join("\n");
}

function privateEnvironment(contents = legacyEnvironment()) {
  const directory = mkdtempSync(join(tmpdir(), "clean-pay-environment-upgrade-"));
  temporaryDirectories.push(directory);
  const path = join(directory, ".env");
  writeFileSync(path, contents, { encoding: "utf8", mode: 0o600 });
  chmodSync(path, 0o600);
  return path;
}

function environment(path: string) {
  return parseProductionEnvironmentFile(readFileSync(path, "utf8"), path);
}

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { force: true, recursive: true });
  }
});

describe("v0.1.1 production environment upgrade", () => {
  it("fails before implicit credential mutation and prepares a fully valid v0.2.0 environment", () => {
    const path = privateEnvironment();
    const before = environment(path);

    expect(() => assertV011UpgradePreparationNotRequired(path)).toThrow(
      "Clean Pay 0.1.1 configuration detected",
    );
    const preparation = prepareV011ProductionEnvironment(path, {
      subscriptionOrigins: "https://sub.clean-pay.dev",
      paymentRedirectOrigins: "https://pay.clean-pay.dev",
      migrationImage: "clean-pay-prod-migration:local",
    });
    expect(preparation.updatedNames).toEqual(expect.arrayContaining([
      "CLEAN_PAY_CONFIG_VERSION",
      "CLEAN_PAY_MIGRATION_IMAGE",
      "CLEAN_PAY_UPGRADE_SOURCE_VERSION",
      "PAYMENT_DATA_RETENTION_ENABLED",
      "PAYMENT_REDIRECT_ORIGINS",
      "REMNASHOP_MINIMUM_ALEMBIC_REVISION",
      "REMNAWAVE_SUBSCRIPTION_ORIGINS",
    ]));
    expect(() => assertV011UpgradePreparationNotRequired(path)).toThrow(
      "Clean Pay 0.1.1 configuration detected",
    );
    initializeDatabaseCredentials(path);

    const upgraded = environment(path);
    expect(() => validateProductionEnvironment(upgraded)).not.toThrow();
    expect(assertV011UpgradePreparationNotRequired(path)).toEqual({ ready: true });
    expect(upgraded.CLEAN_PAY_CONFIG_VERSION).toBe("0.2.0");
    expect(upgraded.CLEAN_PAY_UPGRADE_SOURCE_VERSION).toBe("0.1.1");
    expect(upgraded.PAYMENT_DATA_RETENTION_ENABLED).toBe("false");
    expect(upgraded.PAYMENT_REDIRECT_ORIGINS).toBe("https://pay.clean-pay.dev");
    expect(upgraded.REMNASHOP_MINIMUM_ALEMBIC_REVISION).toBe("0058");
    expect(upgraded.POSTGRES_USER).toBe(before.POSTGRES_USER);
    expect(upgraded.POSTGRES_PASSWORD).toBe(before.POSTGRES_PASSWORD);
    for (const secretName of [
      "REMNASHOP_API_KEY",
      "REMNASHOP_AUTH_SERVICE_KEY",
      "REMNAWAVE_TOKEN",
      "WEB_JWT_SECRET",
      "WEB_REFRESH_SECRET",
      "TELEGRAM_BOT_TOKEN",
    ]) {
      expect(upgraded[secretName]).toBe(before[secretName]);
    }
  });

  it("is idempotent and never silently replaces operator origins or image choices", () => {
    const path = privateEnvironment();
    prepareV011ProductionEnvironment(path, {
      subscriptionOrigins: "https://sub.clean-pay.dev,https://sub2.clean-pay.dev",
      paymentRedirectOrigins: "https://pay.clean-pay.dev,https://pay2.clean-pay.dev",
      migrationImage: "clean-pay-prod-migration:local",
    });
    initializeDatabaseCredentials(path);
    const prepared = readFileSync(path, "utf8");

    expect(prepareV011ProductionEnvironment(path, {
      subscriptionOrigins: "https://sub2.clean-pay.dev,https://sub.clean-pay.dev",
      paymentRedirectOrigins: "https://pay2.clean-pay.dev,https://pay.clean-pay.dev",
      migrationImage: "clean-pay-prod-migration:local",
    })).toEqual({ updatedNames: [] });
    expect(readFileSync(path, "utf8")).toBe(prepared);
    expect(() => prepareV011ProductionEnvironment(path, {
      subscriptionOrigins: "https://other.clean-pay.dev",
      paymentRedirectOrigins: "https://pay.clean-pay.dev,https://pay2.clean-pay.dev",
      migrationImage: "clean-pay-prod-migration:local",
    })).toThrow("already configured differently");
    expect(() => prepareV011ProductionEnvironment(path, {
      subscriptionOrigins: "https://sub.clean-pay.dev,https://sub2.clean-pay.dev",
      paymentRedirectOrigins: "https://other-pay.clean-pay.dev",
      migrationImage: "clean-pay-prod-migration:local",
    })).toThrow("already configured differently");
    expect(() => prepareV011ProductionEnvironment(path, {
      subscriptionOrigins: "https://sub.clean-pay.dev,https://sub2.clean-pay.dev",
      paymentRedirectOrigins: "https://pay.clean-pay.dev,https://pay2.clean-pay.dev",
      migrationImage: "other-migration:local",
    })).toThrow("already configured differently");
    expect(readFileSync(path, "utf8")).toBe(prepared);
  });

  it("rejects unsafe origins and concurrent replacement without changing either source", () => {
    const path = privateEnvironment();
    const before = readFileSync(path, "utf8");
    expect(() => prepareV011ProductionEnvironment(path, {
      subscriptionOrigins: "http://sub.clean-pay.dev",
      paymentRedirectOrigins: "https://pay.clean-pay.dev",
      migrationImage: "clean-pay-prod-migration:local",
    })).toThrow("valid https: URL");
    expect(readFileSync(path, "utf8")).toBe(before);

    const original = `${path}.original`;
    const replacement = "EXTERNAL_EDIT=must-survive\n";
    expect(() => prepareV011ProductionEnvironment(path, {
      subscriptionOrigins: "https://sub.clean-pay.dev",
      paymentRedirectOrigins: "https://pay.clean-pay.dev",
      migrationImage: "clean-pay-prod-migration:local",
      beforePublish() {
        renameSync(path, original);
        writeFileSync(path, replacement, { encoding: "utf8", mode: 0o600 });
        chmodSync(path, 0o600);
      },
    })).toThrow(/changed before publication|refusing to overwrite/);
    expect(readFileSync(path, "utf8")).toBe(replacement);
  });

  it.each([
    {
      label: "an invalid database identifier",
      replace: (contents: string) => contents.replace(
        "POSTGRES_DB=clean_pay",
        "POSTGRES_DB=clean-pay",
      ),
      expected: "POSTGRES_DB is not a valid PostgreSQL identifier",
    },
    {
      label: "a placeholder bootstrap password",
      replace: (contents: string) => contents
        .replace(
          "POSTGRES_PASSWORD=legacy-db-7Qm2Vs8Kp4Nc9Lw6Xr3D5Hz1",
          "POSTGRES_PASSWORD=change-me-bootstrap-database-password",
        )
        .replace(
          "clean_pay:legacy-db-7Qm2Vs8Kp4Nc9Lw6Xr3D5Hz1@",
          "clean_pay:change-me-bootstrap-database-password@",
        ),
      expected: "POSTGRES_PASSWORD is not a valid non-placeholder credential",
    },
    {
      label: "a mismatched legacy database URL",
      replace: (contents: string) => contents.replace(
        "/clean_pay?schema=public",
        "/another_database?schema=public",
      ),
      expected: "DATABASE_URL does not exactly use the legacy bootstrap database credential",
    },
    {
      label: "duplicate database URL query parameters",
      replace: (contents: string) => contents.replace(
        "?schema=public",
        "?schema=public&schema=other",
      ),
      expected: "DATABASE_URL contains invalid or duplicate query parameters",
    },
  ])("rejects $label before publishing any preparation fields", ({ replace, expected }) => {
    const path = privateEnvironment(replace(legacyEnvironment()));
    const before = readFileSync(path, "utf8");

    expect(() => prepareV011ProductionEnvironment(path, {
      subscriptionOrigins: "https://sub.clean-pay.dev",
      paymentRedirectOrigins: "https://pay.clean-pay.dev",
      migrationImage: "clean-pay-prod-migration:local",
    })).toThrow(expected);
    expect(readFileSync(path, "utf8")).toBe(before);
  });

  it("rejects a corrupted interrupted preparation without publishing more changes", () => {
    const path = privateEnvironment(
      `${legacyEnvironment()}\nCLEAN_PAY_UPGRADE_SOURCE_VERSION=0.1.1\n`
        .replace(
          "DATABASE_URL=postgresql://clean_pay:",
          "DATABASE_URL=postgresql://another_role:",
        ),
    );
    const before = readFileSync(path, "utf8");

    expect(() => prepareV011ProductionEnvironment(path, {
      subscriptionOrigins: "https://sub.clean-pay.dev",
      paymentRedirectOrigins: "https://pay.clean-pay.dev",
      migrationImage: "clean-pay-prod-migration:local",
    })).toThrow("interrupted v0.1.1 preparation cannot safely continue");
    expect(readFileSync(path, "utf8")).toBe(before);
  });

  it("does not accept a manually added source-version marker as completed preparation", () => {
    const path = privateEnvironment(
      `${legacyEnvironment()}\nCLEAN_PAY_UPGRADE_SOURCE_VERSION=0.1.1\n`,
    );

    expect(() => assertV011UpgradePreparationNotRequired(path)).toThrow(
      "Clean Pay 0.1.1 configuration detected",
    );
  });

  it("translates effective v0.1.1 database timeouts and removes every legacy URL pool parameter", () => {
    const legacyQuery = [
      "Schema=public",
      "Statement_Timeout=25000",
      "idle_in_transaction_session_timeout=20000",
      "application_name=legacy-clean-pay",
      "connect_timeout=3",
      "connection_limit=12",
      "pool_timeout=4",
    ].join("&");
    const path = privateEnvironment(
      legacyEnvironment().replace("schema=public", legacyQuery),
    );

    prepareV011ProductionEnvironment(path, {
      subscriptionOrigins: "https://sub.clean-pay.dev",
      paymentRedirectOrigins: "https://pay.clean-pay.dev",
      migrationImage: "clean-pay-prod-migration:local",
    });
    const prepared = environment(path);
    expect(prepared.DATABASE_STATEMENT_TIMEOUT_MS).toBe("25000");
    expect(prepared.DATABASE_IDLE_TRANSACTION_TIMEOUT_MS).toBe("20000");
    const preparedUrl = new URL(prepared.DATABASE_URL);
    expect([...preparedUrl.searchParams.keys()]).toEqual(["schema"]);

    initializeDatabaseCredentials(path);
    expect(() => validateProductionEnvironment(environment(path))).not.toThrow();
  });

  it("rejects ambiguous legacy database timeout conversion before changing the file", () => {
    const path = privateEnvironment(
      `${legacyEnvironment()}\nDATABASE_STATEMENT_TIMEOUT_MS=30000\n`
        .replace("schema=public", "schema=public&statement_timeout=25000"),
    );
    const before = readFileSync(path, "utf8");

    expect(() => prepareV011ProductionEnvironment(path, {
      subscriptionOrigins: "https://sub.clean-pay.dev",
      paymentRedirectOrigins: "https://pay.clean-pay.dev",
      migrationImage: "clean-pay-prod-migration:local",
    })).toThrow("conflicts with the legacy DATABASE_URL statement_timeout value");
    expect(readFileSync(path, "utf8")).toBe(before);
  });
});
