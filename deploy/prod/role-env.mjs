#!/usr/bin/env node

import {
  chmodSync,
  closeSync,
  constants,
  existsSync,
  fsyncSync,
  openSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  assertPrivateCredentialDirectory,
  assertPrivateCredentialFile,
  readPrivateCredentialFile,
  sameCredentialFileIdentity,
} from "./credential-file-guard.mjs";
import {
  parseProductionEnvironmentFile,
  validateProductionEnvironment,
} from "./production-env-rules.mjs";

export const PRODUCTION_ROLE_ENVIRONMENT_NAMES = Object.freeze({
  application: Object.freeze([
    "APP_URL",
    "AUDIT_IP_HASH_SECRET",
    "AUTH_CONCURRENCY_LIMIT",
    "AUTH_RATE_LIMIT_CAPACITY",
    "CHATWOOT_BASE_URL",
    "CHATWOOT_HMAC_TOKEN",
    "CHATWOOT_WEBSITE_TOKEN",
    "CLEAN_PAY_DEPLOY_SOURCE",
    "CLEAN_PAY_IMAGE",
    "CLEAN_PAY_MIGRATION_IMAGE",
    "CLEAN_PAY_READINESS_MAILPIT_URL",
    "CLEAN_PAY_READINESS_REMNAWAVE_URL",
    "CLEAN_PAY_RELEASE",
    "CLEAN_PAY_REVISION",
    "COOKIE_SAMESITE",
    "COOKIE_SECURE",
    "DATABASE_CONNECTION_TIMEOUT_MS",
    "DATABASE_IDLE_TIMEOUT_MS",
    "DATABASE_IDLE_TRANSACTION_TIMEOUT_MS",
    "DATABASE_LOCK_TIMEOUT_MS",
    "DATABASE_POOL_MAX",
    "DATABASE_QUERY_TIMEOUT_MS",
    "DATABASE_STATEMENT_TIMEOUT_MS",
    "DATABASE_URL",
    "LOG_LEVEL",
    "NEXT_PUBLIC_APP_URL",
    "NEXT_PUBLIC_BRAND_LOGO_URL",
    "NEXT_PUBLIC_BRAND_NAME",
    "PAYMENT_RECONCILIATION_BATCH_SIZE",
    "PAYMENT_RECONCILIATION_ENABLED",
    "PAYMENT_RECONCILIATION_INTERNAL_URL",
    "PAYMENT_RECONCILIATION_INTERVAL_SECONDS",
    "PAYMENT_RECONCILIATION_SECRET",
    "PAYMENT_REDIRECT_ORIGINS",
    "RATE_LIMIT_IDENTITY_SECRET",
    "READINESS_INTERNAL_SECRET",
    "REDIS_URL",
    "REMNASHOP_ADMIN_API_BASE_URL",
    "REMNASHOP_API_BASE_URL",
    "REMNASHOP_API_KEY",
    "REMNASHOP_AUTH_SERVICE_KEY",
    "REMNAWAVE_API_BASE_URL",
    "REMNAWAVE_SUBSCRIPTION_ORIGINS",
    "REMNAWAVE_TOKEN",
    "SUPPORT_EMAIL",
    "SUPPORT_ENABLED",
    "SUPPORT_FAQ_URL",
    "SUPPORT_TELEGRAM_USERNAME",
    "TELEGRAM_BOT_TOKEN",
    "TELEGRAM_OIDC_AUTHORIZATION_ENDPOINT",
    "TELEGRAM_OIDC_CLIENT_ID",
    "TELEGRAM_OIDC_CLIENT_SECRET",
    "TELEGRAM_OIDC_ISSUER",
    "TELEGRAM_OIDC_JWKS_URI",
    "TELEGRAM_OIDC_TOKEN_ENDPOINT",
    "TRUSTED_PROXY_HOPS",
    "TURNSTILE_ENABLED",
    "TURNSTILE_SECRET_KEY",
    "TURNSTILE_SITE_KEY",
    "TURNSTILE_VERIFY_URL",
    "WEB_JWT_SECRET",
    "WEB_REFRESH_KEY_ID",
    "WEB_REFRESH_PREVIOUS_KEYS",
    "WEB_REFRESH_SECRET",
  ]),
  holdOperator: Object.freeze(["DATABASE_URL"]),
  migration: Object.freeze(["DATABASE_URL"]),
  postgres: Object.freeze([
    "POSTGRES_DB",
    "POSTGRES_PASSWORD",
    "POSTGRES_USER",
  ]),
  reconciliation: Object.freeze([
    "PAYMENT_RECONCILIATION_ENABLED",
    "PAYMENT_RECONCILIATION_INTERNAL_URL",
    "PAYMENT_RECONCILIATION_INTERVAL_SECONDS",
    "PAYMENT_RECONCILIATION_SECRET",
  ]),
  provision: Object.freeze([
    "AUDIT_INFO_RETENTION_DAYS",
    "AUDIT_SECURITY_RETENTION_DAYS",
    "AUTH_STATE_RETENTION_DAYS",
    "CLEAN_PAY_DATABASE_ADOPTION_BACKUP_CONFIRMED",
    "CLEAN_PAY_DATABASE_ADOPT_EXISTING",
    "DATABASE_URL",
    "HOLD_OPERATOR_DATABASE_URL",
    "MIGRATION_DATABASE_URL",
    "PAYMENT_HOLD_DISPOSED_RETENTION_DAYS",
    "PAYMENT_OPERATION_SNAPSHOT_RETENTION_DAYS",
    "PAYMENT_SENSITIVE_RETENTION_DAYS",
    "POSTGRES_DB",
    "POSTGRES_PASSWORD",
    "POSTGRES_USER",
    "RATE_LIMIT_RETENTION_DAYS",
    "RETENTION_DATABASE_URL",
    "SESSION_RETENTION_DAYS",
  ]),
  retention: Object.freeze([
    "AUDIT_INFO_RETENTION_DAYS",
    "AUDIT_SECURITY_RETENTION_DAYS",
    "AUTH_STATE_RETENTION_DAYS",
    "DATABASE_URL",
    "DATA_RETENTION_INTERVAL_SECONDS",
    "PAYMENT_HOLD_DISPOSED_RETENTION_DAYS",
    "PAYMENT_OPERATION_SNAPSHOT_RETENTION_DAYS",
    "PAYMENT_SENSITIVE_RETENTION_DAYS",
    "RATE_LIMIT_RETENTION_DAYS",
    "RETENTION_DATABASE_CONNECTION_TIMEOUT_MS",
    "RETENTION_DATABASE_IDLE_TIMEOUT_MS",
    "RETENTION_DATABASE_IDLE_TRANSACTION_TIMEOUT_MS",
    "RETENTION_DATABASE_LOCK_TIMEOUT_MS",
    "RETENTION_DATABASE_POOL_MAX",
    "RETENTION_DATABASE_QUERY_TIMEOUT_MS",
    "RETENTION_DATABASE_STATEMENT_TIMEOUT_MS",
    "SESSION_RETENTION_DAYS",
  ]),
});

const ROLE_SUFFIX = Object.freeze({
  application: "app",
  holdOperator: "hold-operator",
  migration: "migration",
  postgres: "postgres",
  provision: "provision",
  reconciliation: "reconciliation",
  retention: "retention",
});

const ROLE_DATABASE_URL_SOURCE = Object.freeze({
  application: "DATABASE_URL",
  holdOperator: "HOLD_OPERATOR_DATABASE_URL",
  migration: "MIGRATION_DATABASE_URL",
  retention: "RETENTION_DATABASE_URL",
});

export function productionRoleEnvironmentPaths(authoritativePath) {
  return Object.freeze(Object.fromEntries(
    Object.entries(ROLE_SUFFIX).map(([role, suffix]) => [
      role,
      `${authoritativePath}.${suffix}`,
    ]),
  ));
}

function assignmentLines(contents) {
  const assignments = new Map();
  for (const rawLine of contents.replace(/^\uFEFF/, "").split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const name = /^([A-Za-z_][A-Za-z0-9_]*)\s*=/.exec(line)?.[1];
    if (name) assignments.set(name, line);
  }
  return assignments;
}

function writePrivateFile(path, contents, directoryIdentity) {
  const temporaryPath = `${path}.tmp-${process.pid}`;
  let descriptor;
  try {
    descriptor = openSync(
      temporaryPath,
      constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL,
      0o600,
    );
    writeFileSync(descriptor, contents, "utf8");
    fsyncSync(descriptor);
    closeSync(descriptor);
    descriptor = undefined;
    if (process.platform !== "win32") chmodSync(temporaryPath, 0o600);
    assertPrivateCredentialFile(temporaryPath, "temporary role environment");
    const currentDirectoryIdentity = assertPrivateCredentialDirectory(
      dirname(path),
      "role environment directory before atomic publish",
      { allowedModes: [0o700, 0o750, 0o755] },
    );
    if (!sameCredentialFileIdentity(directoryIdentity, currentDirectoryIdentity)) {
      throw new Error("role environment directory identity changed before atomic publish");
    }
    renameSync(temporaryPath, path);
    fsyncDirectory(dirname(path));
    assertPrivateCredentialFile(path, "role environment");
  } finally {
    if (descriptor !== undefined) closeSync(descriptor);
    if (existsSync(temporaryPath)) unlinkSync(temporaryPath);
  }
}

function fsyncDirectory(directory) {
  if (process.platform === "win32") return;
  const noFollow = typeof constants.O_NOFOLLOW === "number"
    ? constants.O_NOFOLLOW
    : 0;
  const directoryOnly = typeof constants.O_DIRECTORY === "number"
    ? constants.O_DIRECTORY
    : 0;
  const descriptor = openSync(
    directory,
    constants.O_RDONLY | noFollow | directoryOnly,
  );
  try {
    fsyncSync(descriptor);
  } finally {
    closeSync(descriptor);
  }
}

export function materializeProductionRoleEnvironmentFiles(authoritativePath) {
  const directory = dirname(authoritativePath);
  const directoryIdentity = assertPrivateCredentialDirectory(
    directory,
    "role environment directory",
    { allowedModes: [0o700, 0o750, 0o755] },
  );
  const { contents } = readPrivateCredentialFile(
    authoritativePath,
    "authoritative production env",
  );
  const environment = parseProductionEnvironmentFile(contents, authoritativePath);
  validateProductionEnvironment(environment);
  const assignments = assignmentLines(contents);
  const paths = productionRoleEnvironmentPaths(authoritativePath);

  for (const [role, names] of Object.entries(PRODUCTION_ROLE_ENVIRONMENT_NAMES)) {
    const lines = [
      "# Generated from the guarded authoritative environment. Do not edit.",
    ];
    for (const name of names) {
      const sourceName = name === "DATABASE_URL"
        ? ROLE_DATABASE_URL_SOURCE[role] ?? name
        : name;
      let line = assignments.get(sourceName);
      if (line !== undefined && sourceName !== name) {
        line = line.replace(/^[A-Za-z_][A-Za-z0-9_]*\s*=/, `${name}=`);
      }
      if (line !== undefined) lines.push(line);
    }
    writePrivateFile(paths[role], `${lines.join("\n")}\n`, directoryIdentity);
  }

  return paths;
}

if (
  process.argv[1]
  && resolve(fileURLToPath(import.meta.url)) === resolve(process.argv[1])
) {
  try {
    if (process.argv.length !== 4 || process.argv[2] !== "materialize") {
      throw new Error("usage: role-env.mjs materialize AUTHORITATIVE_ENV");
    }
    materializeProductionRoleEnvironmentFiles(process.argv[3]);
    process.stdout.write("Role-scoped production environment files materialized.\n");
  } catch (error) {
    process.stderr.write(
      `Role environment materialization failed: ${error instanceof Error ? error.message : String(error)}\n`,
    );
    process.exitCode = 1;
  }
}
