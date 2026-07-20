import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

import { parse as parsePgConnectionString } from "pg-connection-string";
import { describe, expect, it } from "vitest";

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
  remnashop: "shop-unit-8Wp4Jz7Lc2Nq9Vr5Ks3M",
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
} as const;

const validEnv: Record<string, string> = {
  POSTGRES_DB: "clean_pay",
  POSTGRES_USER: "clean_pay",
  POSTGRES_PASSWORD: secrets.postgres,
  DATABASE_URL: `postgresql://clean_pay:${secrets.postgres}@postgres:5432/clean_pay?schema=public`,
  REDIS_URL: "redis://redis:6379/0",
  APP_URL: "https://pay.clean-pay.dev",
  NEXT_PUBLIC_APP_URL: "https://pay.clean-pay.dev",
  REMNASHOP_API_BASE_URL: "http://remnashop:5000/api/v1/public",
  REMNASHOP_ADMIN_API_BASE_URL: "http://remnashop:5000/api/v1/admin",
  REMNASHOP_API_KEY: secrets.remnashop,
  REMNAWAVE_API_BASE_URL: "https://panel.clean-pay.dev",
  REMNAWAVE_TOKEN: secrets.remnawave,
  WEB_JWT_SECRET: secrets.webJwt,
  WEB_REFRESH_SECRET: secrets.webRefresh,
  AUDIT_IP_HASH_SECRET: secrets.audit,
  RATE_LIMIT_IDENTITY_SECRET: secrets.rateLimit,
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
  TURNSTILE_ENABLED: "false",
  TURNSTILE_SITE_KEY: "",
  TURNSTILE_SECRET_KEY: "",
  TURNSTILE_VERIFY_URL: "https://challenges.cloudflare.com/turnstile/v0/siteverify",
  SUPPORT_ENABLED: "false",
  SUPPORT_EMAIL: "",
  SUPPORT_TELEGRAM_USERNAME: "",
  SUPPORT_FAQ_URL: "",
  PAYMENT_RECONCILIATION_ENABLED: "false",
  PAYMENT_RECONCILIATION_SECRET: "",
  PAYMENT_RECONCILIATION_BATCH_SIZE: "10",
  PAYMENT_RECONCILIATION_INTERVAL_SECONDS: "30",
  PAYMENT_RECONCILIATION_INTERNAL_URL: "http://app:4000/api/internal/payments/reconcile",
  CLEAN_PAY_READINESS_MAILPIT_URL: "http://mailpit:8025",
  CLEAN_PAY_READINESS_REMNAWAVE_URL: "https://panel.clean-pay.dev",
  NEXT_PUBLIC_BRAND_NAME: "Clean Pay",
  NEXT_PUBLIC_BRAND_LOGO_URL: "/clean-pay-logo.png",
  CLEAN_PAY_BIND: "127.0.0.1",
  CLEAN_PAY_PORT: "4000",
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

  writeFileSync(envFile, content);

  const result = spawnSync(
    process.execPath,
    ["deploy/prod/validate-env.mjs", "--env-file", envFile],
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

describe("production env validator", () => {
  it("keeps the production env example limited to variables used by production code", () => {
    const source = [
      "deploy/prod/docker-compose.yml",
      "deploy/prod/production-env-rules.mjs",
      "deploy/prod/validate-env.mjs",
      "deploy/prod/prod.mjs",
      "start.sh",
      "src/backend/config/env.ts",
      "deploy/prod/Dockerfile",
    ]
      .map((file) => readFileSync(file, "utf8"))
      .join("\n");

    for (const key of envExampleKeys()) {
      expect(
        source,
        `${key} from .env.example must be used by production code, compose, or startup`,
      ).toContain(key);
    }
  });

  it("accepts a complete strong configuration including internal HTTP Remnashop", () => {
    const result = runValidator();

    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toContain("Production environment validation passed.");
  });

  it("keeps both example files deliberately invalid until placeholders are replaced", () => {
    for (const envFile of ["deploy/prod/.env.example", ".env.example"]) {
      const result = spawnSync(
        process.execPath,
        ["deploy/prod/validate-env.mjs", "--env-file", envFile],
        { cwd: process.cwd(), encoding: "utf8" },
      );

      expect(result.status, envFile).toBe(1);
      expect(result.stderr).toContain("Production environment validation failed:");
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
    expect(runValidatorContent(
      envContent().replace(
        `WEB_JWT_SECRET=${secrets.webJwt}`,
        `WEB_JWT_SECRET=\" ${secrets.webJwt} \"`,
      ),
    ).stderr).toContain("WEB_JWT_SECRET must not contain surrounding whitespace");
  });

  it("keeps build placeholders build-only and passes the public origin as a non-secret build arg", () => {
    const dockerfile = readFileSync("deploy/prod/Dockerfile", "utf8");
    const rootDockerfile = readFileSync("Dockerfile", "utf8");
    const compose = readFileSync("deploy/prod/docker-compose.yml", "utf8");
    const buildCommand = readFileSync("scripts/next-command.mjs", "utf8");
    const packageJson = readFileSync("package.json", "utf8");
    const prodCommand = readFileSync("deploy/prod/prod.mjs", "utf8");

    expect(dockerfile).toContain("ENV REMNAWAVE_TOKEN=build-time-placeholder");
    expect(dockerfile).toContain("ENV TURNSTILE_SECRET_KEY=build-time-placeholder");
    expect(dockerfile).toContain("ARG NEXT_PUBLIC_APP_URL");
    expect(rootDockerfile).toContain("ARG NEXT_PUBLIC_APP_URL");
    expect(dockerfile).not.toContain("ARG NEXT_PUBLIC_APP_URL=");
    expect(rootDockerfile).not.toContain("ARG NEXT_PUBLIC_APP_URL=");
    expect(dockerfile).toContain(
      "ENV CLEAN_PAY_BAKED_PUBLIC_APP_URL=${NEXT_PUBLIC_APP_URL}",
    );
    expect(rootDockerfile).toContain(
      "ENV CLEAN_PAY_BAKED_PUBLIC_APP_URL=${NEXT_PUBLIC_APP_URL}",
    );
    expect(compose).toContain(
      "NEXT_PUBLIC_APP_URL: ${NEXT_PUBLIC_APP_URL:?NEXT_PUBLIC_APP_URL is required}",
    );
    expect(buildCommand).toContain('CLEAN_PAY_BUILD_PHASE: "true"');
    expect(packageJson).toContain("node deploy/prod/validate-env.mjs && next start");
    expect(prodCommand).toContain("COMPOSE_INTERPOLATION_ENVIRONMENT_NAMES");
    expect(prodCommand).toContain("delete environment[name]");
    expect(prodCommand).toContain("...productionFileEnvironment()");
    expect(prodCommand.match(/env: productionChildEnvironment\(\)/g)).toHaveLength(6);
    expect(runValidator({ CLEAN_PAY_BUILD_PHASE: "true" }).stderr).toContain(
      "CLEAN_PAY_BUILD_PHASE is build-only",
    );
    expect(runValidator({
      CLEAN_PAY_BAKED_PUBLIC_APP_URL: validEnv.NEXT_PUBLIC_APP_URL,
    }).stderr).toContain("is image metadata and must not be set in an env file");
    expect(runRuntimeValidator({
      CLEAN_PAY_BAKED_PUBLIC_APP_URL: validEnv.NEXT_PUBLIC_APP_URL,
    }).status).toBe(0);
    expect(runRuntimeValidator({
      CLEAN_PAY_BAKED_PUBLIC_APP_URL: "https://old.clean-pay.dev",
    }).stderr).toContain("rebuild the image");
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
    expect(runValidator({ WEB_JWT_SECRET: "1234567890".repeat(4) }).stderr).toContain(
      "WEB_JWT_SECRET must not use a repeated or low-variety value",
    );
  });

  it("binds DATABASE_URL to the bundled PostgreSQL credentials", () => {
    expect(runValidator({ POSTGRES_PASSWORD: `${secrets.postgres}-other` }).stderr).toContain(
      "DATABASE_URL password must match POSTGRES_PASSWORD",
    );
    expect(runValidator({ POSTGRES_USER: "other_user" }).stderr).toContain(
      "DATABASE_URL username must match POSTGRES_USER",
    );
    expect(runValidator({ POSTGRES_DB: "other_db" }).stderr).toContain(
      "DATABASE_URL database must match POSTGRES_DB",
    );
    expect(runValidator({
      DATABASE_URL: `postgresql://clean_pay:${secrets.postgres}@postgres:5433/clean_pay?schema=public`,
    }).stderr).toContain("DATABASE_URL must use port 5432");

    const overrideUrl =
      `postgresql://clean_pay:${secrets.postgres}@postgres:5432/clean_pay` +
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
      `postgresql://clean_pay:${secrets.postgres}@postgres:5432/clean_pay` +
      "?sslmode=require&sslmode=disable";
    expect(parsePgConnectionString(duplicateSslModeUrl)).toMatchObject({ ssl: false });
    expect(runValidator({ DATABASE_URL: duplicateSslModeUrl }).stderr).toContain(
      "DATABASE_URL must not repeat the sslmode query parameter",
    );

    expect(runValidator({
      POSTGRES_DB: "clean;id",
      DATABASE_URL: `postgresql://clean_pay:${secrets.postgres}@postgres:5432/clean%3Bid?schema=public`,
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
    expect(runValidator({ RUN_MIGRATIONS: "treu" }).stderr).toContain(
      'RUN_MIGRATIONS must be "true" or "false"',
    );
  });

  it("requires compatible Remnashop bases and a single public Remnawave origin", () => {
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
      CLEAN_PAY_READINESS_REMNAWAVE_URL: "https://status.clean-pay.dev",
    }).stderr).toContain("must use the REMNAWAVE_API_BASE_URL origin");
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
  });
});
