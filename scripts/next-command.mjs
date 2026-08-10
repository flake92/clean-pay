#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import path from "node:path";

const buildOnlyDefaults = {
  DATABASE_URL: "postgresql://clean_pay:clean_pay@localhost:5432/clean_pay?schema=public",
  APP_URL: "http://localhost:4000",
  NEXT_PUBLIC_APP_URL: "http://localhost:4000",
  REMNASHOP_API_BASE_URL: "http://remnashop:5000/api/v1/public",
  REMNASHOP_ADMIN_API_BASE_URL: "http://remnashop:5000/api/v1/admin",
  REMNASHOP_AUTH_SERVICE_KEY: "build-only-remnashop-auth-service-key",
  REMNAWAVE_API_BASE_URL: "http://remnawave:3000",
  REMNAWAVE_TOKEN: "build-only-remnawave-token",
  PAYMENT_RECONCILIATION_ENABLED: "false",
  REDIS_URL: "redis://localhost:6379/0",
  WEB_JWT_SECRET: "build-only-web-jwt-secret",
  WEB_REFRESH_SECRET: "build-only-web-refresh-secret",
  AUDIT_IP_HASH_SECRET: "build-only-audit-ip-secret",
  TRUSTED_PROXY_HOPS: "1",
  RATE_LIMIT_IDENTITY_SECRET: "build-only-rate-limit-secret",
  READINESS_INTERNAL_SECRET: "build-only-readiness-secret",
  COOKIE_SECURE: "false",
  COOKIE_SAMESITE: "lax",
  TELEGRAM_OIDC_CLIENT_ID: "1",
  TELEGRAM_OIDC_CLIENT_SECRET: "build-only-telegram-oidc-secret",
  TURNSTILE_ENABLED: "false",
  SUPPORT_ENABLED: "false",
};

const commands = {
  build: {
    args: ["build"],
    env: {
      CLEAN_PAY_BUILD_PHASE: "true",
      NODE_ENV: "production",
    },
  },
  dev: {
    args: ["dev", "--webpack", "-p", "4000"],
    env: {
      WATCHPACK_POLLING: "true",
    },
  },
};

const [commandName, ...passThroughArgs] = process.argv.slice(2);
const command = commands[commandName];

if (!command) {
  console.error(`Usage: node scripts/next-command.mjs <${Object.keys(commands).join("|")}>`);
  process.exit(2);
}

const nextBin = path.join("node_modules", "next", "dist", "bin", "next");
const result = spawnSync(process.execPath, [nextBin, ...command.args, ...passThroughArgs], {
  cwd: process.cwd(),
  env: {
    ...(commandName === "build" ? buildOnlyDefaults : {}),
    ...process.env,
    ...command.env,
  },
  shell: false,
  stdio: "inherit",
});

if (result.error) {
  console.error(result.error.message);
  process.exit(1);
}

process.exit(result.status ?? 1);
