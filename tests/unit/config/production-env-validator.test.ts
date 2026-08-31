import {
  chmodSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

import { parse as parsePgConnectionString } from "pg-connection-string";
import { describe, expect, it } from "vitest";

import { createEnvForTests, getEnv } from "@/backend/config/env";
import {
  parseProductionEnvironmentFile,
  PRODUCTION_ENVIRONMENT_FILE_NAMES,
  validateProductionEnvironment,
} from "../../../runtime/production-env-rules.mjs";
import {
  materializeProductionRoleEnvironmentFiles,
  PRODUCTION_ROLE_ENVIRONMENT_NAMES,
} from "../../../deploy/prod/role-env.mjs";

function envExampleKeys() {
  return readFileSync("deploy/prod/.env.example", "utf8")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("#"))
    .map((line) => line.split("=")[0])
    .filter(Boolean);
}

const secrets = {
  postgres: "pg-unit-9QvL2xR8mT4pK7sN6cWd",
  databaseApplication: "db-app-unit-8Nc4Kp2Vr7Xm9Ls5Qw3H",
  databaseMigration: "db-migration-unit-4Qp8Xs2Ln7Vr5Km9Wc3H",
  databaseRetention: "db-retention-unit-6Wm3Kq9Vr2Xs8Lc5Np7H",
  databaseHold: "db-hold-unit-9Vr4Kp7Xs2Lm8Nc5Qw3H",
  remnashop: "shop-unit-8Wp4Jz7Lc2Nq9Vr5Ks3M",
  remnashopAuth: "auth-service-unit-7Vr3Nm8Wp2Kq5Xs9Lc4D",
  remnawave: "wave-unit-7Nq3Kp9Xs4Vm2Lc8Wr6J",
  webJwt: "jwt-unit-6Vr2Kp8Wm4Xq9Lc3Ns7D5Hz1",
  webRefresh: "refresh-unit-5Kq8Vr2Nm7Wp4Lc9Xs3D6Hz1",
  audit: "audit-unit-4Wp7Kq2Vr9Nm5Xs8Lc3D6Hz1",
  rateLimit: "rate-limit-unit-7Xs2Lc8Nm4Wp9Kq5Vr3D6Hz1",
  readiness: "readiness-unit-5Vr8Xs3Lc7Nm4Wp9Kq2D6Hz1",
  telegramOidc: "oidc-unit-3Nm8Wp5Kq2Vr7Xs9Lc4D6Hz1",
  telegramBot: "7654321098:BotTokenUnitOnly_9QvL2xR8mT4p",
  reconciliation: "reconcile-unit-2Lc7Nm4Wp9Kq5Vr8Xs3D6Hz1",
  turnstile: "turnstile-unit-8Xs3Lc7Nm4Wp9Kq5Vr2D6Hz1",
  chatwoot: "chatwoot-unit-6Nm3Wp8Kq2Vr7Xs9Lc4D5Hz1",
} as const;

const validEnv: Record<string, string> = {
  CLEAN_PAY_DEPLOY_SOURCE: "build",
  CLEAN_PAY_IMAGE: "clean-pay-prod-app:local",
  CLEAN_PAY_MIGRATION_IMAGE: "clean-pay-prod-migration:local",
  CLEAN_PAY_RELEASE: "local",
  CLEAN_PAY_REVISION: "local",
  POSTGRES_DB: "clean_pay",
  POSTGRES_USER: "clean_pay_bootstrap",
  POSTGRES_PASSWORD: secrets.postgres,
  DATABASE_URL: `postgresql://clean_pay_app:${secrets.databaseApplication}@postgres:5432/clean_pay?schema=public`,
  MIGRATION_DATABASE_URL: `postgresql://clean_pay_migration:${secrets.databaseMigration}@postgres:5432/clean_pay?schema=public`,
  RETENTION_DATABASE_URL: `postgresql://clean_pay_retention:${secrets.databaseRetention}@postgres:5432/clean_pay?schema=public`,
  HOLD_OPERATOR_DATABASE_URL: `postgresql://clean_pay_hold:${secrets.databaseHold}@postgres:5432/clean_pay?schema=public`,
  CLEAN_PAY_DATABASE_ADOPT_EXISTING: "false",
  CLEAN_PAY_DATABASE_ADOPTION_BACKUP_CONFIRMED: "false",
  REDIS_URL: "redis://redis:6379/0",
  APP_URL: "https://pay.clean-pay.dev",
  NEXT_PUBLIC_APP_URL: "https://pay.clean-pay.dev",
  REMNASHOP_API_BASE_URL: "http://remnashop:5000/api/v1/public",
  REMNASHOP_ADMIN_API_BASE_URL: "http://remnashop:5000/api/v1/admin",
  REMNASHOP_API_KEY: secrets.remnashop,
  REMNASHOP_AUTH_SERVICE_KEY: secrets.remnashopAuth,
  REMNAWAVE_API_BASE_URL: "https://panel.clean-pay.dev",
  REMNAWAVE_TOKEN: secrets.remnawave,
  REMNAWAVE_SUBSCRIPTION_ORIGINS: "https://subscription.clean-pay.dev",
  WEB_JWT_SECRET: secrets.webJwt,
  WEB_REFRESH_SECRET: secrets.webRefresh,
  AUDIT_IP_HASH_SECRET: secrets.audit,
  TRUSTED_PROXY_HOPS: "1",
  RATE_LIMIT_IDENTITY_SECRET: secrets.rateLimit,
  AUTH_RATE_LIMIT_CAPACITY: "1000",
  AUTH_CONCURRENCY_LIMIT: "64",
  READINESS_INTERNAL_SECRET: secrets.readiness,
  TELEGRAM_OIDC_ISSUER: "https://oauth.telegram.org",
  TELEGRAM_OIDC_AUTHORIZATION_ENDPOINT: "https://oauth.telegram.org/auth",
  TELEGRAM_OIDC_TOKEN_ENDPOINT: "https://oauth.telegram.org/token",
  TELEGRAM_OIDC_JWKS_URI: "https://oauth.telegram.org/.well-known/jwks.json",
  TELEGRAM_OIDC_CLIENT_ID: "7654321098",
  TELEGRAM_OIDC_CLIENT_SECRET: secrets.telegramOidc,
  TELEGRAM_BOT_TOKEN: secrets.telegramBot,
  COOKIE_SECURE: "true",
  COOKIE_SAMESITE: "lax",
  TURNSTILE_ENABLED: "true",
  TURNSTILE_SITE_KEY: "0x4AAAAAUnitOnlySiteKey8Wp4Jz7Lc2",
  TURNSTILE_SECRET_KEY: secrets.turnstile,
  TURNSTILE_VERIFY_URL: "https://challenges.cloudflare.com/turnstile/v0/siteverify",
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
  PAYMENT_RECONCILIATION_INTERNAL_URL: "http://app:4000/api/internal/payments/reconcile",
  PAYMENT_REDIRECT_ORIGINS: "https://yoomoney.ru,https://pay.platega.io",
  CLEAN_PAY_READINESS_MAILPIT_URL: "http://mailpit:8025",
  CLEAN_PAY_READINESS_REMNAWAVE_URL: "https://panel.clean-pay.dev",
  NEXT_PUBLIC_BRAND_NAME: "Clean Pay",
  NEXT_PUBLIC_BRAND_LOGO_URL: "/clean-pay-logo.png",
  CLEAN_PAY_BIND: "127.0.0.1",
  CLEAN_PAY_PORT: "4000",
  REMNASHOP_ENV_FILE: "/opt/remnashop/.env",
  REMNASHOP_ENV_EXPECTED_UID: "0",
  REMNASHOP_ENV_EXPECTED_GID: "0",
};

type EnvOverride = Record<string, string | null>;

function envContent(overrides: EnvOverride = {}) {
  const values: Record<string, string> = { ...validEnv };

  for (const [name, value] of Object.entries(overrides)) {
    if (value === null) {
      delete values[name];
    } else {
      values[name] = value;
    }
  }

  return Object.entries(values)
    .map(([key, value]) => `${key}=${value}`)
    .join("\n");
}

function runValidator(overrides: EnvOverride = {}) {
  return runValidatorContent(envContent(overrides));
}

function runValidatorContent(content: string) {
  const dir = mkdtempSync(path.join(tmpdir(), "clean-pay-env-"));
  const envFile = path.join(dir, ".env");

  writeFileSync(envFile, content, { mode: 0o600 });
  chmodSync(envFile, 0o600);

  const result = spawnSync(
    process.execPath,
    ["deploy/prod/validate-env.mjs", "--clean-pay-env-file", envFile],
    {
      cwd: process.cwd(),
      encoding: "utf8",
      env: {
        ...process.env,
        // An env file must never inherit a missing production value from the host.
        WEB_JWT_SECRET: "ambient-value-must-not-be-used",
      },
    },
  );

  rmSync(dir, { recursive: true, force: true });
  return result;
}

function runRuntimeValidator(overrides: EnvOverride = {}) {
  const environment: NodeJS.ProcessEnv = {
    ...process.env,
    ...validEnv,
    CLEAN_PAY_BUILD_PHASE: "",
  };

  for (const [name, value] of Object.entries(overrides)) {
    if (value === null) {
      delete environment[name];
    } else {
      environment[name] = value;
    }
  }

  return spawnSync(process.execPath, ["deploy/prod/validate-env.mjs"], {
    cwd: process.cwd(),
    encoding: "utf8",
    env: environment,
  });
}

function runRuntimeStdinValidator(overrides: EnvOverride = {}) {
  const runtimeMetadata: NodeJS.ProcessEnv = {
    ...process.env,
    CLEAN_PAY_BAKED_PUBLIC_APP_URL: validEnv.NEXT_PUBLIC_APP_URL,
    CLEAN_PAY_BAKED_BRAND_NAME: validEnv.NEXT_PUBLIC_BRAND_NAME,
    CLEAN_PAY_BAKED_BRAND_LOGO_URL: validEnv.NEXT_PUBLIC_BRAND_LOGO_URL,
    CLEAN_PAY_BAKED_TURNSTILE_WIDGET_ID: validEnv.TURNSTILE_SITE_KEY,
  };

  return spawnSync(process.execPath, ["deploy/prod/validate-env.mjs", "--runtime-env-stdin"], {
    cwd: process.cwd(),
    encoding: "utf8",
    env: runtimeMetadata,
    input: envContent(overrides),
  });
}

describe("production env validator", () => {
  it("keeps the production env example limited to variables used by production code", () => {
    const source = [
      "deploy/prod/docker-compose.yml",
      "runtime/production-env-rules.mjs",
      "deploy/prod/validate-env.mjs",
      "deploy/prod/prod.mjs",
      "deploy/prod/prepare-remnashop-rollout.sh",
      "start.sh",
      "src/backend/config/env.ts",
      "Dockerfile",
    ]
      .map((file) => readFileSync(file, "utf8"))
      .join("\n");

    for (const key of envExampleKeys()) {
      expect(
        source,
        `${key} from .env.example must be used by production code, compose, or startup`,
      ).toContain(key);
      expect(PRODUCTION_ENVIRONMENT_FILE_NAMES, `${key} must be allowlisted`)
        .toContain(key);
    }

    expect(PRODUCTION_ENVIRONMENT_FILE_NAMES).not.toContain("NODE_OPTIONS");
    expect(PRODUCTION_ENVIRONMENT_FILE_NAMES).not.toContain(
      "CLEAN_PAY_BAKED_TURNSTILE_WIDGET_ID",
    );
    expect(PRODUCTION_ENVIRONMENT_FILE_NAMES).not.toContain(
      "CLEAN_PAY_READINESS_TELEGRAM_OIDC_JWKS_URL",
    );
    for (const names of Object.values(PRODUCTION_ROLE_ENVIRONMENT_NAMES)) {
      expect(names).not.toContain("CLEAN_PAY_READINESS_TELEGRAM_OIDC_JWKS_URL");
    }
  });

  it("accepts a complete strong configuration including internal HTTP Remnashop", () => {
    const result = runValidator();

    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toContain("Production environment validation passed.");
  });

  it("rejects unsafe Docker names, invalid rollout revisions and unknown log levels", () => {
    for (const [name, value, expected] of [
      ["COMPOSE_PROJECT_NAME", "Clean Pay", "lowercase letters"],
      ["CLEAN_PAY_EDGE_NETWORK", "--help", "Docker-safe"],
      ["REMNASHOP_DOCKER_NETWORK", "network/name", "Docker-safe"],
      ["REMNASHOP_API_CONTAINER", "--format", "Docker-safe"],
      ["REMNASHOP_WORKER_CONTAINER", "worker name", "Docker-safe"],
      ["REMNASHOP_SCHEDULER_CONTAINER", ".scheduler", "Docker-safe"],
      ["REMNASHOP_POSTGRES_CONTAINER", "postgres:name", "Docker-safe"],
      ["REMNASHOP_MINIMUM_ALEMBIC_REVISION", "58-or-newer", "numeric revision"],
      ["LOG_LEVEL", "verbose", "debug, info, warn, or error"],
    ] as const) {
      expect(
        () => validateProductionEnvironment({ ...validEnv, [name]: value }),
        `${name}=${value}`,
      ).toThrow(expected);
    }

    expect(() => validateProductionEnvironment({
      ...validEnv,
      COMPOSE_PROJECT_NAME: "clean-pay_prod",
      CLEAN_PAY_EDGE_NETWORK: "remnawave-network",
      REMNASHOP_API_CONTAINER: "Remnashop.api-1",
      REMNASHOP_MINIMUM_ALEMBIC_REVISION: "0058",
      LOG_LEVEL: "DEBUG",
    })).not.toThrow();
  });

  it("materializes private role-scoped env sets without unrelated secret families", () => {
    const directory = mkdtempSync(path.join(tmpdir(), "clean-pay-role-env-"));
    const authoritative = path.join(directory, ".env");

    try {
      writeFileSync(authoritative, envContent({
        PAYMENT_RECONCILIATION_ENABLED: "true",
        PAYMENT_RECONCILIATION_SECRET: secrets.reconciliation,
        AUTH_STATE_RETENTION_DAYS: "7",
        SESSION_RETENTION_DAYS: "91",
        AUDIT_INFO_RETENTION_DAYS: "181",
        AUDIT_SECURITY_RETENTION_DAYS: "366",
        RATE_LIMIT_RETENTION_DAYS: "31",
        PAYMENT_SENSITIVE_RETENTION_DAYS: "32",
        PAYMENT_OPERATION_SNAPSHOT_RETENTION_DAYS: "92",
        PAYMENT_HOLD_DISPOSED_RETENTION_DAYS: "367",
        DATA_RETENTION_INTERVAL_SECONDS: "21601",
      }), { mode: 0o600 });
      chmodSync(authoritative, 0o600);
      const paths = materializeProductionRoleEnvironmentFiles(authoritative);
      const roleEnvironment = Object.fromEntries(
        Object.entries(paths).map(([role, file]) => [
          role,
          parseProductionEnvironmentFile(readFileSync(file, "utf8"), file),
        ]),
      ) as Record<string, Record<string, string>>;

      expect(Object.keys(roleEnvironment.migration!).sort())
        .toEqual([...PRODUCTION_ROLE_ENVIRONMENT_NAMES.migration].sort());
      expect(roleEnvironment.migration!.DATABASE_URL).toContain(secrets.databaseMigration);
      expect(roleEnvironment.migration).not.toHaveProperty("POSTGRES_PASSWORD");
      expect(JSON.stringify(roleEnvironment.migration)).not.toContain(secrets.webJwt);
      expect(JSON.stringify(roleEnvironment.migration)).not.toContain(secrets.remnashop);
      expect(JSON.stringify(roleEnvironment.migration)).not.toContain(secrets.reconciliation);

      expect(roleEnvironment.retention!.DATABASE_URL).toContain(secrets.databaseRetention);
      expect(JSON.stringify(roleEnvironment.retention)).not.toContain(secrets.webJwt);
      expect(JSON.stringify(roleEnvironment.retention)).not.toContain(secrets.remnashop);
      expect(JSON.stringify(roleEnvironment.retention)).not.toContain(secrets.reconciliation);

      expect(roleEnvironment.reconciliation!.PAYMENT_RECONCILIATION_ENABLED).toBe("true");
      expect(JSON.stringify(roleEnvironment.reconciliation)).not.toContain(secrets.postgres);
      expect(JSON.stringify(roleEnvironment.reconciliation)).not.toContain(secrets.webJwt);
      expect(JSON.stringify(roleEnvironment.reconciliation)).not.toContain(secrets.remnashop);

      expect(roleEnvironment.postgres).toEqual({
        POSTGRES_DB: "clean_pay",
        POSTGRES_USER: "clean_pay_bootstrap",
        POSTGRES_PASSWORD: secrets.postgres,
      });
      expect(roleEnvironment.holdOperator!.DATABASE_URL).toContain(secrets.databaseHold);
      expect(roleEnvironment.provision!.POSTGRES_PASSWORD).toBe(secrets.postgres);
      expect(roleEnvironment.provision!.DATABASE_URL).toContain(secrets.databaseApplication);
      expect(roleEnvironment.application!.WEB_JWT_SECRET).toBe(secrets.webJwt);
      expect(roleEnvironment.application!.DATABASE_URL).toContain(secrets.databaseApplication);
      expect(roleEnvironment.application).not.toHaveProperty("POSTGRES_DB");
      expect(roleEnvironment.application).not.toHaveProperty("POSTGRES_USER");
      expect(roleEnvironment.application).not.toHaveProperty("POSTGRES_PASSWORD");

      const originalEnvironment = process.env;
      try {
        process.env = {
          ...roleEnvironment.application,
          NODE_ENV: "production",
          CLEAN_PAY_BUILD_PHASE: "",
          CLEAN_PAY_BAKED_PUBLIC_APP_URL: validEnv.NEXT_PUBLIC_APP_URL,
          CLEAN_PAY_BAKED_BRAND_NAME: validEnv.NEXT_PUBLIC_BRAND_NAME,
          CLEAN_PAY_BAKED_BRAND_LOGO_URL: validEnv.NEXT_PUBLIC_BRAND_LOGO_URL,
          CLEAN_PAY_BAKED_TURNSTILE_WIDGET_ID: validEnv.TURNSTILE_SITE_KEY,
        };
        expect(() => getEnv()).toThrow("POSTGRES_DB is required");

        process.env.CLEAN_PAY_RUNTIME_ROLE = "application";
        expect(getEnv().appUrl).toBe(validEnv.APP_URL);
        expect(process.env.POSTGRES_DB).toBeUndefined();
        expect(process.env.POSTGRES_USER).toBeUndefined();
        expect(process.env.POSTGRES_PASSWORD).toBeUndefined();
      } finally {
        process.env = originalEnvironment;
      }

      expect(roleEnvironment.retention!.SESSION_RETENTION_DAYS).toBe("91");
      expect(roleEnvironment.retention!.PAYMENT_HOLD_DISPOSED_RETENTION_DAYS)
        .toBe("367");
      expect(roleEnvironment.reconciliation!.PAYMENT_RECONCILIATION_SECRET)
        .toBe(secrets.reconciliation);

      const rendered = spawnSync(
        "docker",
        [
          "compose",
          "--env-file",
          authoritative,
          "--file",
          "deploy/prod/docker-compose.yml",
          "--profile",
          "reconciliation",
          "--profile",
          "operations",
          "config",
          "--format",
          "json",
        ],
        {
          cwd: process.cwd(),
          encoding: "utf8",
          env: {
            ...process.env,
            CLEAN_PAY_APP_ENV_FILE: paths.application,
            CLEAN_PAY_HOLD_OPERATOR_ENV_FILE: paths.holdOperator,
            CLEAN_PAY_MIGRATION_ENV_FILE: paths.migration,
            CLEAN_PAY_POSTGRES_ENV_FILE: paths.postgres,
            CLEAN_PAY_PROVISION_ENV_FILE: paths.provision,
            CLEAN_PAY_RECONCILIATION_ENV_FILE: paths.reconciliation,
            CLEAN_PAY_RETENTION_ENV_FILE: paths.retention,
          },
        },
      );
      expect(rendered.status, rendered.stderr).toBe(0);
      const services = (JSON.parse(rendered.stdout) as {
        services: Record<string, { environment: Record<string, string> }>;
      }).services;
      const applicationContainer = services.app!.environment;
      const migrationContainer = services.migration!.environment;
      const postgresContainer = services.postgres!.environment;
      const reconciliationContainer = services["reconciliation-worker"]!.environment;
      const retentionContainer = services["retention-worker"]!.environment;
      const holdContainer = services["retention-hold"]!.environment;
      const provisionContainer = services["db-role-provision"]!.environment;

      expect(applicationContainer.CLEAN_PAY_RUNTIME_ROLE).toBe("application");
      expect(applicationContainer.DATABASE_URL).toContain(secrets.databaseApplication);
      expect(applicationContainer.WEB_JWT_SECRET).toBe(secrets.webJwt);
      expect(applicationContainer).not.toHaveProperty("POSTGRES_DB");
      expect(applicationContainer).not.toHaveProperty("POSTGRES_USER");
      expect(applicationContainer).not.toHaveProperty("POSTGRES_PASSWORD");

      expect(migrationContainer.CLEAN_PAY_RUNTIME_ROLE).toBe("migration");
      expect(migrationContainer.DATABASE_URL).toContain(secrets.databaseMigration);
      expect(migrationContainer).not.toHaveProperty("POSTGRES_PASSWORD");
      expect(JSON.stringify(migrationContainer)).not.toContain(secrets.webJwt);
      expect(JSON.stringify(migrationContainer)).not.toContain(secrets.remnashop);
      expect(JSON.stringify(migrationContainer)).not.toContain(secrets.reconciliation);

      expect(postgresContainer).toEqual({
        POSTGRES_DB: "clean_pay",
        POSTGRES_INITDB_ARGS:
          "--encoding=UTF8 --locale-provider=libc --lc-collate=C --lc-ctype=C.UTF-8",
        POSTGRES_PASSWORD: secrets.postgres,
        POSTGRES_USER: "clean_pay_bootstrap",
      });

      expect(reconciliationContainer.PAYMENT_RECONCILIATION_SECRET)
        .toBe(secrets.reconciliation);
      expect(reconciliationContainer.CLEAN_PAY_RUNTIME_ROLE)
        .toBe("reconciliation");
      expect(reconciliationContainer.PAYMENT_RECONCILIATION_INTERNAL_URL)
        .toBe(validEnv.PAYMENT_RECONCILIATION_INTERNAL_URL);
      expect(JSON.stringify(reconciliationContainer)).not.toContain(secrets.postgres);
      expect(JSON.stringify(reconciliationContainer)).not.toContain(secrets.webJwt);
      expect(JSON.stringify(reconciliationContainer)).not.toContain(secrets.remnashop);

      expect(retentionContainer.DATABASE_URL).toContain(secrets.databaseRetention);
      expect(retentionContainer.CLEAN_PAY_RUNTIME_ROLE).toBe("retention");
      expect(retentionContainer.SESSION_RETENTION_DAYS).toBe("91");
      expect(JSON.stringify(retentionContainer)).not.toContain(secrets.webJwt);
      expect(JSON.stringify(retentionContainer)).not.toContain(secrets.remnashop);
      expect(JSON.stringify(retentionContainer)).not.toContain(secrets.reconciliation);
      expect(holdContainer.DATABASE_URL).toContain(secrets.databaseHold);
      expect(holdContainer.CLEAN_PAY_RUNTIME_ROLE).toBe("hold-operator");
      expect(provisionContainer.POSTGRES_PASSWORD).toBe(secrets.postgres);
      expect(provisionContainer.CLEAN_PAY_RUNTIME_ROLE).toBe("provision");

      const rootRendered = spawnSync(
        "docker",
        [
          "compose",
          "--env-file",
          authoritative,
          "--file",
          "docker-compose.yml",
          "--profile",
          "reconciliation",
          "--profile",
          "operations",
          "config",
          "--format",
          "json",
        ],
        {
          cwd: process.cwd(),
          encoding: "utf8",
          env: {
            ...process.env,
            CLEAN_PAY_APP_ENV_FILE: paths.application,
            CLEAN_PAY_HOLD_OPERATOR_ENV_FILE: paths.holdOperator,
            CLEAN_PAY_MIGRATION_ENV_FILE: paths.migration,
            CLEAN_PAY_POSTGRES_ENV_FILE: paths.postgres,
            CLEAN_PAY_PROVISION_ENV_FILE: paths.provision,
            CLEAN_PAY_RECONCILIATION_ENV_FILE: paths.reconciliation,
            CLEAN_PAY_RETENTION_ENV_FILE: paths.retention,
          },
        },
      );
      expect(rootRendered.status, rootRendered.stderr).toBe(0);
      const rootServices = (JSON.parse(rootRendered.stdout) as {
        services: Record<string, { environment: Record<string, string> }>;
      }).services;
      expect(rootServices.app!.environment.CLEAN_PAY_RUNTIME_ROLE)
        .toBe("application");
      expect(rootServices.app!.environment).not.toHaveProperty("POSTGRES_PASSWORD");
      expect(rootServices.migration!.environment.CLEAN_PAY_RUNTIME_ROLE)
        .toBe("migration");
      expect(JSON.stringify(rootServices.migration!.environment))
        .not.toContain(secrets.webJwt);
      expect(rootServices["reconciliation-worker"]!.environment.CLEAN_PAY_RUNTIME_ROLE)
        .toBe("reconciliation");
      expect(JSON.stringify(rootServices["reconciliation-worker"]!.environment))
        .not.toContain(secrets.postgres);
      expect(rootServices["retention-worker"]!.environment.CLEAN_PAY_RUNTIME_ROLE)
        .toBe("retention");
      expect(JSON.stringify(rootServices["retention-worker"]!.environment))
        .not.toContain(secrets.webJwt);
      expect(rootServices.postgres!.environment).toEqual({
        POSTGRES_DB: "clean_pay",
        POSTGRES_INITDB_ARGS:
          "--encoding=UTF8 --locale-provider=libc --lc-collate=C --lc-ctype=C.UTF-8",
        POSTGRES_PASSWORD: secrets.postgres,
        POSTGRES_USER: "clean_pay_bootstrap",
      });

      if (process.platform !== "win32") {
        for (const file of Object.values(paths)) {
          expect(statSync(file).mode & 0o777).toBe(0o600);
        }
      }
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  }, process.platform === "win32" ? 45_000 : 15_000);

  it("validates an application role from DATABASE_URL without PostgreSQL bootstrap variables", () => {
    const result = runRuntimeValidator({
      CLEAN_PAY_RUNTIME_ROLE: "application",
      POSTGRES_DB: null,
      POSTGRES_USER: null,
      POSTGRES_PASSWORD: null,
      MIGRATION_DATABASE_URL: null,
      RETENTION_DATABASE_URL: null,
      HOLD_OPERATOR_DATABASE_URL: null,
    });

    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toContain("Production environment validation passed.");
  });

  it("rejects peer and bootstrap database values from every role-scoped runtime", () => {
    const isolated = {
      POSTGRES_DB: null,
      POSTGRES_USER: null,
      POSTGRES_PASSWORD: null,
      POSTGRES_INITDB_ARGS: null,
      MIGRATION_DATABASE_URL: null,
      RETENTION_DATABASE_URL: null,
      HOLD_OPERATOR_DATABASE_URL: null,
    } as const;
    const roles = [
      ["application", validEnv.DATABASE_URL],
      ["migration", validEnv.MIGRATION_DATABASE_URL],
      ["retention", validEnv.RETENTION_DATABASE_URL],
      ["hold-operator", validEnv.HOLD_OPERATOR_DATABASE_URL],
    ] as const;

    for (const [role, databaseUrl] of roles) {
      const clean = runRuntimeValidator({
        ...isolated,
        CLEAN_PAY_RUNTIME_ROLE: role,
        DATABASE_URL: databaseUrl,
      });
      expect(clean.status, `${role}: ${clean.stderr}`).toBe(0);

      for (const exposedName of [
        "POSTGRES_DB",
        "POSTGRES_USER",
        "POSTGRES_PASSWORD",
        "POSTGRES_INITDB_ARGS",
        "MIGRATION_DATABASE_URL",
        "RETENTION_DATABASE_URL",
        "HOLD_OPERATOR_DATABASE_URL",
      ]) {
        const exposed = runRuntimeValidator({
          ...isolated,
          CLEAN_PAY_RUNTIME_ROLE: role,
          DATABASE_URL: databaseUrl,
          [exposedName]: "unexpected-role-secret",
        });
        expect(exposed.status, `${role}/${exposedName}`).toBe(1);
        expect(exposed.stderr).toContain(
          `${exposedName} must not be present in a role-scoped runtime environment`,
        );
      }
    }
  }, process.platform === "win32" ? 45_000 : 15_000);

  it("keeps both example files deliberately invalid until placeholders are replaced", () => {
    for (const envFile of ["deploy/prod/.env.example", ".env.example"]) {
      const example = readFileSync(envFile, "utf8");
      const result = spawnSync(
        process.execPath,
        ["deploy/prod/validate-env.mjs", "--clean-pay-env-file", envFile],
        { cwd: process.cwd(), encoding: "utf8" },
      );

      expect(result.status, envFile).toBe(1);
      expect(result.stderr).toContain("Production environment validation failed:");
      expect(example).not.toContain("local-development-payment-reconciliation-secret");
    }
  });

  it("isolates env-file values and rejects malformed or duplicate assignments", () => {
    expect(runValidator({ WEB_JWT_SECRET: null }).stderr).toContain(
      "WEB_JWT_SECRET is required",
    );
    expect(runValidatorContent(`${envContent()}\nWEB_JWT_SECRET=duplicate`).stderr).toContain(
      "duplicates WEB_JWT_SECRET",
    );
    expect(runValidatorContent(`${envContent()}\nNOT_AN_ASSIGNMENT`).stderr).toContain(
      "must be a NAME=value assignment",
    );
    expect(runValidatorContent(`${envContent()}\nBROKEN=\"unterminated`).stderr).toContain(
      "contains an unterminated quoted value",
    );
    expect(runValidatorContent(`${envContent()}\nUNUSED=$AMBIENT_VALUE`).stderr).toContain(
      "must not use environment interpolation",
    );
    expect(runValidatorContent(`${envContent()}\nINLINE=value # comment`).stderr).toContain(
      "must use a standalone comment line",
    );
    expect(runValidatorContent(`${envContent()}\nEXPANDED=${"${OTHER}"}`).stderr).toContain(
      "must not use environment interpolation",
    );
    expect(runValidatorContent(`${envContent()}\nCOMPOSE_PROFILES=debug`).stderr).toContain(
      "must not set Compose control variable COMPOSE_PROFILES",
    );
    expect(runValidatorContent(`${envContent()}\nNODE_OPTIONS=--require=/tmp/payload.cjs`).stderr)
      .toContain("unsupported runtime variable NODE_OPTIONS");
    expect(runValidatorContent(
      envContent().replace(
        `WEB_JWT_SECRET=${secrets.webJwt}`,
        `WEB_JWT_SECRET=\" ${secrets.webJwt} \"`,
      ),
    ).stderr).toContain("WEB_JWT_SECRET must not contain surrounding whitespace");
  });

  it("keeps build placeholders build-only and passes the public origin as a non-secret build arg", () => {
    const dockerfile = readFileSync("Dockerfile", "utf8");
    const compose = readFileSync("deploy/prod/docker-compose.yml", "utf8");
    const buildCommand = readFileSync("scripts/next-command.mjs", "utf8");
    const packageJson = readFileSync("package.json", "utf8");
    const prodCommand = readFileSync("deploy/prod/prod.mjs", "utf8");

    expect(dockerfile).not.toContain("ENV REMNAWAVE_TOKEN=");
    expect(dockerfile).not.toContain("ENV TURNSTILE_SECRET_KEY=");
    expect(buildCommand).toContain('REMNAWAVE_TOKEN: "build-only-remnawave-token"');
    expect(buildCommand).toContain('TURNSTILE_ENABLED: "false"');
    expect(dockerfile).toContain("ARG NEXT_PUBLIC_APP_URL");
    expect(dockerfile).not.toContain("ARG NEXT_PUBLIC_APP_URL=");
    expect(dockerfile).toContain(
      "ENV CLEAN_PAY_BAKED_PUBLIC_APP_URL=${NEXT_PUBLIC_APP_URL}",
    );
    expect(dockerfile).toContain(
      "ENV CLEAN_PAY_BAKED_BRAND_NAME=${NEXT_PUBLIC_BRAND_NAME}",
    );
    expect(dockerfile).toContain(
      "ENV CLEAN_PAY_BAKED_BRAND_LOGO_URL=${NEXT_PUBLIC_BRAND_LOGO_URL}",
    );
    expect(dockerfile).toContain(
      "ENV CLEAN_PAY_BAKED_TURNSTILE_WIDGET_ID=${TURNSTILE_WIDGET_ID}",
    );
    expect(compose).toContain(
      "NEXT_PUBLIC_APP_URL: ${NEXT_PUBLIC_APP_URL:?NEXT_PUBLIC_APP_URL is required}",
    );
    expect(buildCommand).toContain('CLEAN_PAY_BUILD_PHASE: "true"');
    expect(packageJson).toContain("node deploy/prod/validate-env.mjs && next start");
    expect(prodCommand).toContain("COMPOSE_INTERPOLATION_ENVIRONMENT_NAMES");
    expect(prodCommand).toContain("delete environment[name]");
    expect(prodCommand).toContain("...productionFileEnvironment()");
    expect(prodCommand.match(/env: productionChildEnvironment\(\)/g)?.length ?? 0)
      .toBeGreaterThanOrEqual(10);
    expect(runValidator({ CLEAN_PAY_BUILD_PHASE: "true" }).stderr).toContain(
      "CLEAN_PAY_BUILD_PHASE is build-only",
    );
    expect(runValidator({
      CLEAN_PAY_BAKED_PUBLIC_APP_URL: validEnv.NEXT_PUBLIC_APP_URL,
    }).stderr).toContain("is image metadata and must not be set in an env file");
    expect(runValidator({
      CLEAN_PAY_BAKED_BRAND_NAME: validEnv.NEXT_PUBLIC_BRAND_NAME,
    }).stderr).toContain("is image metadata and must not be set in an env file");
    expect(runRuntimeValidator({
      CLEAN_PAY_BAKED_PUBLIC_APP_URL: validEnv.NEXT_PUBLIC_APP_URL,
      CLEAN_PAY_BAKED_BRAND_NAME: validEnv.NEXT_PUBLIC_BRAND_NAME,
      CLEAN_PAY_BAKED_BRAND_LOGO_URL: validEnv.NEXT_PUBLIC_BRAND_LOGO_URL,
    }).status).toBe(0);
    expect(runRuntimeValidator({
      CLEAN_PAY_BAKED_PUBLIC_APP_URL: "https://old.clean-pay.dev",
    }).stderr).toContain("rebuild the image");
    expect(runRuntimeValidator({
      CLEAN_PAY_BAKED_BRAND_NAME: "Old Brand",
    }).stderr).toContain("CLEAN_PAY_BAKED_BRAND_NAME must match NEXT_PUBLIC_BRAND_NAME");
    expect(runRuntimeValidator({
      CLEAN_PAY_BAKED_BRAND_LOGO_URL: "/old-logo.png",
    }).stderr).toContain("CLEAN_PAY_BAKED_BRAND_LOGO_URL must match NEXT_PUBLIC_BRAND_LOGO_URL");
    expect(runRuntimeValidator({
      CLEAN_PAY_BAKED_TURNSTILE_WIDGET_ID: "0x4AAAAADifferentSiteKey8Wp4Jz7Lc2",
    }).stderr).toContain("CLEAN_PAY_BAKED_TURNSTILE_WIDGET_ID must match TURNSTILE_SITE_KEY");
    expect(runRuntimeStdinValidator().status).toBe(0);
    expect(runRuntimeStdinValidator({
      CLEAN_PAY_BAKED_PUBLIC_APP_URL: validEnv.NEXT_PUBLIC_APP_URL,
    }).stderr).toContain("is image metadata and must not be set in an env file");
    expect(runRuntimeStdinValidator({
      NEXT_PUBLIC_BRAND_NAME: "Different Brand",
    }).stderr).toContain("CLEAN_PAY_BAKED_BRAND_NAME must match NEXT_PUBLIC_BRAND_NAME");
  });

  it("allows pull mode only with two distinct digest-pinned target images", () => {
    const applicationImage = `ghcr.io/flake92/clean-pay-app@sha256:${"a".repeat(64)}`;
    const migrationImage = `ghcr.io/flake92/clean-pay-migration@sha256:${"b".repeat(64)}`;

    expect(runValidator({
      CLEAN_PAY_DEPLOY_SOURCE: "pull",
      CLEAN_PAY_IMAGE: applicationImage,
      CLEAN_PAY_MIGRATION_IMAGE: migrationImage,
      CLEAN_PAY_RELEASE: "0.1.1",
      CLEAN_PAY_REVISION: "0123456789abcdef0123456789abcdef01234567",
    }).status).toBe(0);
    expect(runValidator({
      CLEAN_PAY_RELEASE: "0.1.1",
      CLEAN_PAY_REVISION: "local",
    }).stderr).toContain("must both be local or both be traceable");
    expect(runValidator({
      CLEAN_PAY_RELEASE: "0.1.1",
      CLEAN_PAY_REVISION: "not-a-commit",
    }).stderr).toContain("exact lowercase Git commit hash");
    expect(runValidator({ CLEAN_PAY_DEPLOY_SOURCE: "registry" }).stderr).toContain(
      'CLEAN_PAY_DEPLOY_SOURCE must be "build" or "pull"',
    );
    expect(runValidator({
      CLEAN_PAY_DEPLOY_SOURCE: "pull",
      CLEAN_PAY_IMAGE: null,
      CLEAN_PAY_MIGRATION_IMAGE: migrationImage,
    }).stderr).toContain("CLEAN_PAY_IMAGE is required");
    expect(runValidator({
      CLEAN_PAY_DEPLOY_SOURCE: "pull",
      CLEAN_PAY_IMAGE: "ghcr.io/flake92/clean-pay-app:latest",
      CLEAN_PAY_MIGRATION_IMAGE: migrationImage,
    }).stderr).toContain("CLEAN_PAY_IMAGE must be pinned by an exact sha256 digest");
    expect(runValidator({
      CLEAN_PAY_DEPLOY_SOURCE: "pull",
      CLEAN_PAY_IMAGE: applicationImage,
      CLEAN_PAY_MIGRATION_IMAGE: "ghcr.io/flake92/clean-pay-migration:v1",
    }).stderr).toContain("CLEAN_PAY_MIGRATION_IMAGE must be pinned by an exact sha256 digest");
    expect(runValidator({
      CLEAN_PAY_DEPLOY_SOURCE: "pull",
      CLEAN_PAY_IMAGE: applicationImage,
      CLEAN_PAY_MIGRATION_IMAGE: applicationImage,
    }).stderr).toContain("must use different sha256 digests");
  });

  it("requires one exact public HTTPS app origin and secure cookies", () => {
    expect(runValidator({ APP_URL: "http://pay.clean-pay.dev" }).stderr).toContain(
      "APP_URL must be a valid https: URL",
    );
    expect(runValidator({ APP_URL: "https://localhost:4000" }).stderr).toContain(
      "APP_URL must not use localhost",
    );
    expect(runValidator({ APP_URL: "https://localhost." }).stderr).toContain(
      "APP_URL must not use localhost",
    );
    expect(runValidator({ APP_URL: "https://foo.localhost." }).stderr).toContain(
      "APP_URL must not use localhost",
    );
    expect(runValidator({ APP_URL: "https://pay.example.com." }).stderr).toContain(
      "APP_URL must use a public, non-placeholder hostname",
    );
    expect(runValidator({ APP_URL: "https://192.0.2.10" }).stderr).toContain(
      "APP_URL must use a public, non-placeholder hostname",
    );
    expect(runValidator({ APP_URL: "https://pay.clean-pay.dev/account" }).stderr).toContain(
      "APP_URL must contain only an origin",
    );
    expect(runValidator({ NEXT_PUBLIC_APP_URL: "https://other.clean-pay.dev" }).stderr).toContain(
      "APP_URL and NEXT_PUBLIC_APP_URL must be the same HTTPS origin",
    );
    expect(runValidator({ COOKIE_SECURE: "false" }).stderr).toContain(
      'COOKIE_SECURE must be "true" in production',
    );
  });

  it("rejects placeholder, short, repeated, and reused secrets", () => {
    expect(runValidator({ REMNASHOP_API_KEY: "change-me-api-key-value-123456" }).stderr).toContain(
      "REMNASHOP_API_KEY must not use a placeholder",
    );
    expect(runValidator({ WEB_JWT_SECRET: "short" }).stderr).toContain(
      "WEB_JWT_SECRET must be at least 32 characters",
    );
    expect(runValidator({ WEB_JWT_SECRET: "Ab".repeat(20) }).stderr).toContain(
      "WEB_JWT_SECRET must not use a repeated or low-variety value",
    );
    expect(runValidator({ WEB_REFRESH_SECRET: secrets.webJwt }).stderr).toContain(
      "WEB_REFRESH_SECRET must be different from WEB_JWT_SECRET",
    );
    expect(runValidator({ WEB_JWT_SECRET: "change_me_runtime_web_jwt_value_123" }).stderr).toContain(
      "WEB_JWT_SECRET must not use a placeholder",
    );
    expect(runValidator({
      PAYMENT_RECONCILIATION_SECRET:
        "local-development-payment-reconciliation-secret",
    }).stderr).toContain(
      "PAYMENT_RECONCILIATION_SECRET must not use a placeholder or known weak value",
    );
    expect(runValidator({ WEB_JWT_SECRET: "1234567890".repeat(4) }).stderr).toContain(
      "WEB_JWT_SECRET must not use a repeated or low-variety value",
    );
  });

  it("validates a bounded refresh encryption read keyring", () => {
    const previous = "previous-refresh-unit-8Wp4Jz7Lc2Nq9Vr5Ks3D6Hz1";
    expect(runValidator({
      WEB_REFRESH_KEY_ID: "key-b",
      WEB_REFRESH_PREVIOUS_KEYS: JSON.stringify({ "key-a": previous }),
    }).status).toBe(0);
    expect(runValidator({ WEB_REFRESH_KEY_ID: "invalid.key" }).stderr).toContain(
      "WEB_REFRESH_KEY_ID must contain 1 to 32 safe key-id characters",
    );
    expect(runValidator({
      WEB_REFRESH_KEY_ID: "key-a",
      WEB_REFRESH_PREVIOUS_KEYS: JSON.stringify({ "key-a": previous }),
    }).status).toBe(0);
    expect(runValidator({
      WEB_REFRESH_KEY_ID: "key-b",
      WEB_REFRESH_PREVIOUS_KEYS: JSON.stringify({ "invalid.key": previous }),
    }).stderr).toContain("contains an invalid key id");
    expect(runValidator({
      WEB_REFRESH_KEY_ID: "key-b",
      WEB_REFRESH_PREVIOUS_KEYS: JSON.stringify({ "key-a": secrets.webRefresh }),
    }).stderr).toContain(
      "WEB_REFRESH_PREVIOUS_KEYS.key-a must be different from WEB_REFRESH_SECRET",
    );
  });

  it("requires distinct role credentials on one exact database target", () => {
    expect(runValidator({ POSTGRES_PASSWORD: `${secrets.postgres}-other` }).status).toBe(0);
    expect(runValidator({ POSTGRES_USER: "other_bootstrap" }).status).toBe(0);
    expect(runValidator({
      DATABASE_URL: `postgresql://clean_pay_bootstrap:${secrets.databaseApplication}@postgres:5432/clean_pay?schema=public`,
    }).stderr).toContain("database usernames must be pairwise distinct");
    expect(runValidator({
      DATABASE_URL: `postgresql://clean_pay_app:${secrets.postgres}@postgres:5432/clean_pay?schema=public`,
    }).stderr).toContain("DATABASE_URL password must be different from POSTGRES_PASSWORD");
    expect(runValidator({ POSTGRES_DB: "other_db" }).stderr).toContain(
      "DATABASE_URL database must match POSTGRES_DB",
    );
    expect(runValidator({
      DATABASE_URL: `postgresql://clean_pay_app:${secrets.databaseApplication}@postgres:5433/clean_pay?schema=public`,
    }).stderr).toContain("DATABASE_URL must use port 5432");

    const overrideUrl =
      `postgresql://clean_pay_app:${secrets.databaseApplication}@postgres:5432/clean_pay` +
      "?host=attacker.clean-pay.dev&user=other&password=other&sslmode=verify-full";
    expect(parsePgConnectionString(overrideUrl)).toMatchObject({
      host: "attacker.clean-pay.dev",
      user: "other",
      password: "other",
    });
    expect(runValidator({ DATABASE_URL: overrideUrl }).stderr).toContain(
      "DATABASE_URL query parameter host is not allowed",
    );

    const duplicateSslModeUrl =
      `postgresql://clean_pay_app:${secrets.databaseApplication}@postgres:5432/clean_pay` +
      "?sslmode=require&sslmode=disable";
    expect(parsePgConnectionString(duplicateSslModeUrl)).toMatchObject({ ssl: false });
    expect(runValidator({ DATABASE_URL: duplicateSslModeUrl }).stderr).toContain(
      "DATABASE_URL must not repeat the sslmode query parameter",
    );

    expect(runValidator({
      DATABASE_URL:
        `postgresql://clean_pay_app:${secrets.databaseApplication}@postgres:5432/clean_pay?Schema=public`,
    }).stderr).toContain(
      "DATABASE_URL query parameter Schema must use canonical lowercase spelling",
    );

    for (const parameter of [
      "connection_limit=2",
      "pool_timeout=3",
      "connect_timeout=4",
      "statement_timeout=5000",
      "idle_in_transaction_session_timeout=5000",
      "application_name=misleading",
    ]) {
      expect(runValidator({
        DATABASE_URL:
          `postgresql://clean_pay_app:${secrets.databaseApplication}@postgres:5432/clean_pay?schema=public&${parameter}`,
      }).stderr).toContain("role-specific environment setting");
    }

    expect(runValidator({ DATABASE_POOL_MAX: "0" }).stderr).toContain(
      "DATABASE_POOL_MAX must be an integer between 1 and 50",
    );
    expect(runValidator({ DATABASE_CONNECTION_TIMEOUT_MS: "1e3" }).stderr).toContain(
      "DATABASE_CONNECTION_TIMEOUT_MS must be a canonical decimal integer",
    );
    expect(runValidator({ RETENTION_DATABASE_LOCK_TIMEOUT_MS: "300001" }).stderr).toContain(
      "RETENTION_DATABASE_LOCK_TIMEOUT_MS must be an integer between 250 and 300000",
    );

    expect(runValidator({
      POSTGRES_DB: "clean;id",
      DATABASE_URL: `postgresql://clean_pay_app:${secrets.databaseApplication}@postgres:5432/clean%3Bid?schema=public`,
    }).stderr).toContain("POSTGRES_DB must be a shell-safe PostgreSQL identifier");

    for (const composeFile of ["docker-compose.yml", "deploy/prod/docker-compose.yml"]) {
      expect(readFileSync(composeFile, "utf8")).toContain(
        'pg_isready -U \\"$${POSTGRES_USER}\\" -d \\"$${POSTGRES_DB}\\"',
      );
    }
  });

  it("locks bundled Redis and public asset paths to their production contracts", () => {
    expect(runValidator({
      REDIS_URL: "rediss://cacheuser:redis-unit-5Kq8Vr2Nm7Wp4Lc9Xs3D@cache.clean-pay.dev:6380/1",
    }).status).toBe(0);
    expect(runValidator({
      REDIS_URL: `rediss://cacheuser:${encodeURIComponent(secrets.webJwt)}@cache.clean-pay.dev:6380/1`,
    }).stderr).toContain("REDIS_URL password must be different from WEB_JWT_SECRET");
    expect(runValidator({ REDIS_URL: "redis://redis:6380/0" }).stderr).toContain(
      "REDIS_URL must use port 6379",
    );
    expect(runValidator({ REDIS_URL: "redis://user:password@redis:6379/0" }).stderr).toContain(
      "REDIS_URL must not include credentials",
    );
    expect(runValidator({ REDIS_URL: "redis://redis:6379/cache" }).stderr).toContain(
      "REDIS_URL must use a numeric Redis database path",
    );
    expect(runValidator({ NEXT_PUBLIC_BRAND_LOGO_URL: "/brand/%2e%2e/private.png" }).stderr).toContain(
      "NEXT_PUBLIC_BRAND_LOGO_URL must be a root-relative public path",
    );
    expect(runValidator({ NEXT_PUBLIC_BRAND_LOGO_URL: "/brand/logo.png?token=x" }).stderr).toContain(
      "NEXT_PUBLIC_BRAND_LOGO_URL must be a root-relative public path",
    );
    expect(runValidator({ CLEAN_PAY_PORT: "4e3" }).stderr).toContain(
      "CLEAN_PAY_PORT must be a canonical decimal integer",
    );
    expect(runValidator({ PAYMENT_RECONCILIATION_BATCH_SIZE: "+10" }).stderr).toContain(
      "PAYMENT_RECONCILIATION_BATCH_SIZE must be a canonical decimal integer",
    );
    expect(runValidator({ AUTH_STATE_RETENTION_DAYS: "0" }).stderr).toContain(
      "AUTH_STATE_RETENTION_DAYS must be an integer between 1 and 30",
    );
    expect(runValidator({
      AUDIT_INFO_RETENTION_DAYS: "400",
      AUDIT_SECURITY_RETENTION_DAYS: "365",
    }).stderr).toContain(
      "AUDIT_SECURITY_RETENTION_DAYS must be at least AUDIT_INFO_RETENTION_DAYS",
    );
    expect(runValidator({ DATA_RETENTION_INTERVAL_SECONDS: "299" }).stderr).toContain(
      "DATA_RETENTION_INTERVAL_SECONDS must be an integer between 300 and 86400",
    );
    expect(runValidator({ PAYMENT_HOLD_DISPOSED_RETENTION_DAYS: "89" }).stderr).toContain(
      "PAYMENT_HOLD_DISPOSED_RETENTION_DAYS must be an integer between 90 and 2555",
    );
  });

  it("requires compatible Remnashop bases and a single public Remnawave origin", () => {
    expect(runValidator({ REMNASHOP_ENV_FILE: "relative/.env" }).stderr).toContain(
      "REMNASHOP_ENV_FILE must be a normalized absolute file path",
    );
    expect(runValidator({ REMNASHOP_ENV_FILE: "/opt/remnashop/../shared/.env" }).stderr)
      .toContain("REMNASHOP_ENV_FILE must be a normalized absolute file path");
    expect(runValidator({ REMNASHOP_ENV_EXPECTED_UID: "root" }).stderr).toContain(
      "REMNASHOP_ENV_EXPECTED_UID must be a canonical decimal integer",
    );
    expect(runValidator({ REMNASHOP_ENV_EXPECTED_GID: "2147483648" }).stderr).toContain(
      "REMNASHOP_ENV_EXPECTED_GID must be an integer between 0 and 2147483647",
    );
    expect(runValidator({
      REMNASHOP_API_BASE_URL: "http://shop.clean-pay.dev/api/v1/public",
    }).stderr).toContain("REMNASHOP_API_BASE_URL must use HTTPS for a public host");
    expect(runValidator({
      REMNASHOP_API_BASE_URL: "http://fdomain.clean-pay.dev/api/v1/public",
    }).stderr).toContain("REMNASHOP_API_BASE_URL must use HTTPS for a public host");
    expect(runValidator({
      REMNASHOP_ADMIN_API_BASE_URL: "http://other:5000/api/v1/admin",
    }).stderr).toContain("REMNASHOP_ADMIN_API_BASE_URL must use the same origin");
    expect(runValidator({
      REMNASHOP_ADMIN_API_BASE_URL: "http://remnashop:5000/api/v2/admin",
    }).stderr).toContain("REMNASHOP_ADMIN_API_BASE_URL must end with /api/v1/admin");
    expect(runValidator({ REMNAWAVE_API_BASE_URL: "http://remnawave:3000" }).stderr).toContain(
      "REMNAWAVE_API_BASE_URL must be a valid https: URL",
    );
    expect(runValidator({
      REMNAWAVE_SUBSCRIPTION_ORIGINS: "http://subscription.clean-pay.dev",
    }).stderr).toContain("REMNAWAVE_SUBSCRIPTION_ORIGINS[1] must be a valid https: URL");
    expect(runValidator({
      REMNAWAVE_SUBSCRIPTION_ORIGINS: "https://localhost:8443",
    }).stderr).toContain("must not use localhost or a loopback address");
    expect(runValidator({
      REMNAWAVE_SUBSCRIPTION_ORIGINS: "https://user:password@subscription.clean-pay.dev",
    }).stderr).toContain("must not include URL credentials");
    expect(runValidator({
      REMNAWAVE_SUBSCRIPTION_ORIGINS: "https://subscription.clean-pay.dev/path",
    }).stderr).toContain("must contain only an origin");
    expect(runValidator({
      CLEAN_PAY_READINESS_REMNAWAVE_URL: "https://status.clean-pay.dev",
    }).stderr).toContain("must use the REMNAWAVE_API_BASE_URL origin");
  });

  it("restricts the canary-only Telegram readiness URL to its owned Remnashop provider", () => {
    const alias = "zdt-readiness-0123456789abcdef";
    const origin = `http://${alias}:4190`;
    const environment = {
      ...validEnv,
      REMNASHOP_API_BASE_URL: `${origin}/api/v1/public`,
      REMNASHOP_ADMIN_API_BASE_URL: `${origin}/api/v1/admin`,
      CLEAN_PAY_READINESS_TELEGRAM_OIDC_JWKS_URL:
        `${origin}/.well-known/jwks.json`,
    };

    expect(() => validateProductionEnvironment(environment)).not.toThrow();
    const parsed = createEnvForTests(environment);
    expect(parsed.readiness.telegramOidcJwksUrl)
      .toBe(`${origin}/.well-known/jwks.json`);
    expect(parsed.telegramOidc.jwksUri)
      .toBe("https://oauth.telegram.org/.well-known/jwks.json");

    const currentOrigin = `http://${alias}:4191`;
    expect(() => validateProductionEnvironment({
      ...environment,
      REMNASHOP_API_BASE_URL: `${currentOrigin}/api/v1/public`,
      REMNASHOP_ADMIN_API_BASE_URL: `${currentOrigin}/api/v1/admin`,
      CLEAN_PAY_READINESS_TELEGRAM_OIDC_JWKS_URL:
        `${currentOrigin}/.well-known/jwks.json`,
    })).not.toThrow();

    for (const invalid of [
      "https://oauth.telegram.org/.well-known/jwks.json",
      "http://127.0.0.1:4190/.well-known/jwks.json",
      "http://zdt-readiness-0123456789abcdeg:4190/.well-known/jwks.json",
      "http://zdt-readiness-0123456789abcdef:4191/.well-known/jwks.json",
      "http://zdt-readiness-0123456789abcdef:4190/.well-known/jwks.json/",
      "http://zdt-readiness-0123456789abcdef:4190/.well-known/%6awks.json",
      "http://zdt-readiness-0123456789abcdef:4190/.well-known/jwks.json?probe=1",
      "http://zdt-readiness-0123456789abcdef:4190/.well-known/jwks.json#probe",
      "http://user:password@zdt-readiness-0123456789abcdef:4190/.well-known/jwks.json",
    ]) {
      expect(() => validateProductionEnvironment({
        ...environment,
        CLEAN_PAY_READINESS_TELEGRAM_OIDC_JWKS_URL: invalid,
      }), invalid).toThrow();
    }
    expect(() => validateProductionEnvironment({
      ...environment,
      REMNASHOP_API_BASE_URL: "http://zdt-readiness-fedcba9876543210:4190/api/v1/public",
      REMNASHOP_ADMIN_API_BASE_URL: "http://zdt-readiness-fedcba9876543210:4190/api/v1/admin",
    })).toThrow("restricted to the exact disposable readiness provider origin");
  });

  it("derives the admin URL when it is omitted, including for reconciliation", () => {
    expect(runValidator({ REMNASHOP_ADMIN_API_BASE_URL: null }).status).toBe(0);
    expect(runValidator({
      REMNASHOP_ADMIN_API_BASE_URL: null,
      PAYMENT_RECONCILIATION_ENABLED: "true",
      PAYMENT_RECONCILIATION_SECRET: secrets.reconciliation,
    }).status).toBe(0);
    expect(runValidator({
      PAYMENT_RECONCILIATION_ENABLED: "true",
      PAYMENT_RECONCILIATION_SECRET: secrets.reconciliation,
      PAYMENT_RECONCILIATION_INTERNAL_URL:
        "https://pay.clean-pay.dev/api/internal/payments/reconcile",
    }).stderr).toContain(
      "PAYMENT_RECONCILIATION_INTERNAL_URL must use an internal service hostname",
    );
  });

  it("validates an exact public HTTPS override while preserving ZDT rollback compatibility", () => {
    expect(runValidator({ PAYMENT_REDIRECT_ORIGINS: null }).status).toBe(0);
    expect(runValidator({
      PAYMENT_REDIRECT_ORIGINS: "http://yoomoney.ru",
    }).stderr).toContain("PAYMENT_REDIRECT_ORIGINS[1] must be a valid https: URL");
    expect(runValidator({
      PAYMENT_REDIRECT_ORIGINS: "https://user:password@yoomoney.ru",
    }).stderr).toContain("must not include URL credentials");
    expect(runValidator({
      PAYMENT_REDIRECT_ORIGINS: "https://yoomoney.ru/checkout",
    }).stderr).toContain("must contain only an origin");
    expect(runValidator({
      PAYMENT_REDIRECT_ORIGINS: "https://yoomoney.ru,https://yoomoney.ru",
    }).stderr).toContain("must not contain duplicate origins");
    expect(runValidator({
      PAYMENT_REDIRECT_ORIGINS: "https://yoomoney.ru,https://pay.platega.io",
    }).status).toBe(0);
  });

  it("validates Telegram identity and enabled feature destinations", () => {
    expect(runValidator({ TELEGRAM_OIDC_CLIENT_ID: "1234567890" }).stderr).toContain(
      "TELEGRAM_OIDC_CLIENT_ID must match the bot id in TELEGRAM_BOT_TOKEN",
    );
    expect(runValidator({ TELEGRAM_BOT_TOKEN: "7654321098:short" }).stderr).toContain(
      "TELEGRAM_BOT_TOKEN must be a complete Telegram bot token",
    );
    expect(runValidator({
      TELEGRAM_OIDC_ISSUER: "https://oidc.clean-pay.dev",
    }).stderr).toContain("must use the official Telegram OIDC endpoint");
    expect(runValidator({
      TELEGRAM_OIDC_CLIENT_SECRET: secrets.telegramBot,
    }).status).toBe(0);

    expect(runValidator({
      TURNSTILE_ENABLED: "true",
      TURNSTILE_SITE_KEY: "",
      TURNSTILE_SECRET_KEY: "",
    }).stderr).toContain("TURNSTILE_SITE_KEY is required when TURNSTILE_ENABLED=true");
    expect(runValidator({
      TURNSTILE_ENABLED: "true",
      TURNSTILE_SITE_KEY: "0x4AAAAAUnitOnlySiteKey8Wp4Jz7Lc2",
      TURNSTILE_SECRET_KEY: secrets.turnstile,
      TURNSTILE_VERIFY_URL: "https://verify.clean-pay.dev/siteverify",
    }).stderr).toContain("TURNSTILE_VERIFY_URL must use the official Cloudflare endpoint");
    expect(runValidator({
      TURNSTILE_ENABLED: "true",
      TURNSTILE_SITE_KEY: "0x4AAAAAUnitOnlySiteKey8Wp4Jz7Lc2",
      TURNSTILE_SECRET_KEY: secrets.turnstile,
      TURNSTILE_VERIFY_URL: null,
    }).status).toBe(0);
    expect(runValidator({
      TURNSTILE_SITE_KEY: "1x00000000000000000000AA",
    }).stderr).toContain("must not use a Cloudflare test key in production");

    expect(runValidator({ SUPPORT_ENABLED: "true" }).status).toBe(0);
    expect(runValidator({
      SUPPORT_ENABLED: "true",
      SUPPORT_FAQ_URL: "http://support.clean-pay.dev/faq",
    }).stderr).toContain("SUPPORT_FAQ_URL must be a valid https: URL");

    expect(runValidator({
      CHATWOOT_BASE_URL: "https://chat.clean-pay.dev",
      CHATWOOT_WEBSITE_TOKEN: "website_token_123456789",
      CHATWOOT_HMAC_TOKEN: secrets.chatwoot,
    }).status).toBe(0);
    expect(runValidator({
      CHATWOOT_BASE_URL: "https://chat.clean-pay.dev",
      CHATWOOT_WEBSITE_TOKEN: "website_token_123456789",
    }).stderr).toContain(
      "CHATWOOT_BASE_URL, CHATWOOT_WEBSITE_TOKEN and CHATWOOT_HMAC_TOKEN must be configured together",
    );
    expect(runValidator({
      CHATWOOT_BASE_URL: "http://chat.clean-pay.dev",
      CHATWOOT_WEBSITE_TOKEN: "website_token_123456789",
      CHATWOOT_HMAC_TOKEN: secrets.chatwoot,
    }).stderr).toContain("CHATWOOT_BASE_URL must be a valid https: URL");
    expect(runValidator({
      CHATWOOT_BASE_URL: "https://chat.clean-pay.dev/app",
      CHATWOOT_WEBSITE_TOKEN: "website_token_123456789",
      CHATWOOT_HMAC_TOKEN: secrets.chatwoot,
    }).stderr).toContain("CHATWOOT_BASE_URL must contain only an origin");
    expect(runValidator({
      CHATWOOT_BASE_URL: "https://chat.clean-pay.dev",
      CHATWOOT_WEBSITE_TOKEN: "short",
      CHATWOOT_HMAC_TOKEN: secrets.chatwoot,
    }).stderr).toContain("CHATWOOT_WEBSITE_TOKEN must be a complete Chatwoot token");
    expect(runValidator({
      CHATWOOT_BASE_URL: "https://chat.clean-pay.dev",
      CHATWOOT_WEBSITE_TOKEN: "website_token_123456789",
      CHATWOOT_HMAC_TOKEN: secrets.webJwt,
    }).stderr).toContain("CHATWOOT_HMAC_TOKEN must be different from WEB_JWT_SECRET");
  });
});
