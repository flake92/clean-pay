#!/usr/bin/env node

import { randomBytes } from "node:crypto";
import { chmodSync, readFileSync, writeFileSync } from "node:fs";

const output = process.argv[2];
if (!output) {
  throw new Error("usage: write-synthetic-production-env.mjs OUTPUT");
}

const secret = (prefix) => `${prefix}-${randomBytes(24).toString("base64url")}`;
const postgres = secret("ci-postgres");
const applicationDatabase = secret("ci-db-app");
const migrationDatabase = secret("ci-db-migration");
const retentionDatabase = secret("ci-db-retention");
const holdDatabase = secret("ci-db-hold");
const replacements = new Map([
  ["POSTGRES_USER", "clean_pay_bootstrap"],
  ["POSTGRES_PASSWORD", postgres],
  [
    "DATABASE_URL",
    `postgresql://clean_pay_app:${applicationDatabase}@postgres:5432/clean_pay?schema=public`,
  ],
  [
    "MIGRATION_DATABASE_URL",
    `postgresql://clean_pay_migration:${migrationDatabase}@postgres:5432/clean_pay?schema=public`,
  ],
  [
    "RETENTION_DATABASE_URL",
    `postgresql://clean_pay_retention:${retentionDatabase}@postgres:5432/clean_pay?schema=public`,
  ],
  [
    "HOLD_OPERATOR_DATABASE_URL",
    `postgresql://clean_pay_hold:${holdDatabase}@postgres:5432/clean_pay?schema=public`,
  ],
  ["APP_URL", "https://pay.ci.clean-pay.dev"],
  ["NEXT_PUBLIC_APP_URL", "https://pay.ci.clean-pay.dev"],
  ["REMNASHOP_API_BASE_URL", "https://shop.ci.clean-pay.dev/api/v1/public"],
  ["REMNASHOP_ADMIN_API_BASE_URL", "https://shop.ci.clean-pay.dev/api/v1/admin"],
  ["REMNASHOP_API_KEY", secret("ci-remnashop")],
  ["REMNASHOP_AUTH_SERVICE_KEY", secret("ci-remnashop-auth")],
  ["PAYMENT_RECONCILIATION_SECRET", secret("ci-reconciliation")],
  ["REMNAWAVE_API_BASE_URL", "https://panel.ci.clean-pay.dev"],
  ["REMNAWAVE_TOKEN", secret("ci-remnawave")],
  ["REMNAWAVE_SUBSCRIPTION_ORIGINS", "https://subscription.ci.clean-pay.dev"],
  ["WEB_JWT_SECRET", secret("ci-web-jwt")],
  ["WEB_REFRESH_SECRET", secret("ci-web-refresh")],
  ["AUDIT_IP_HASH_SECRET", secret("ci-audit")],
  ["RATE_LIMIT_IDENTITY_SECRET", secret("ci-rate-limit")],
  ["READINESS_INTERNAL_SECRET", secret("ci-readiness")],
  ["TELEGRAM_OIDC_CLIENT_ID", "7654321098"],
  ["TELEGRAM_OIDC_CLIENT_SECRET", secret("ci-telegram-oidc")],
  ["TELEGRAM_BOT_TOKEN", `7654321098:${secret("CiBotToken")}`],
  ["TURNSTILE_SITE_KEY", `0x4AAAAA${randomBytes(18).toString("base64url")}`],
  ["TURNSTILE_SECRET_KEY", secret("ci-turnstile")],
]);

const publicAppUrl = process.env.CLEAN_PAY_FIXTURE_PUBLIC_APP_URL?.trim();
if (publicAppUrl) {
  replacements.set("APP_URL", publicAppUrl);
  replacements.set("NEXT_PUBLIC_APP_URL", publicAppUrl);
}
for (const [name, environmentName] of [
  ["NEXT_PUBLIC_BRAND_NAME", "CLEAN_PAY_FIXTURE_BRAND_NAME"],
  ["NEXT_PUBLIC_BRAND_LOGO_URL", "CLEAN_PAY_FIXTURE_BRAND_LOGO_URL"],
  ["TURNSTILE_SITE_KEY", "CLEAN_PAY_FIXTURE_TURNSTILE_SITE_KEY"],
  ["CLEAN_PAY_DEPLOY_SOURCE", "CLEAN_PAY_FIXTURE_DEPLOY_SOURCE"],
  ["CLEAN_PAY_IMAGE", "CLEAN_PAY_FIXTURE_APPLICATION_IMAGE"],
  ["CLEAN_PAY_MIGRATION_IMAGE", "CLEAN_PAY_FIXTURE_MIGRATION_IMAGE"],
  ["CLEAN_PAY_RELEASE", "CLEAN_PAY_FIXTURE_RELEASE"],
  ["CLEAN_PAY_REVISION", "CLEAN_PAY_FIXTURE_REVISION"],
]) {
  const value = process.env[environmentName]?.trim();
  if (value) replacements.set(name, value);
}

const lines = readFileSync("deploy/prod/.env.example", "utf8")
  .split(/\r?\n/)
  .map((line) => {
    const name = /^([A-Za-z_][A-Za-z0-9_]*)=/.exec(line)?.[1];
    return name && replacements.has(name)
      ? `${name}=${replacements.get(name)}`
      : line;
  });

writeFileSync(output, lines.join("\n"), { encoding: "utf8", mode: 0o600 });
if (process.platform !== "win32") chmodSync(output, 0o600);
