#!/usr/bin/env node

import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  readPrivateCredentialFile,
  writePrivateCredentialFileCas,
} from "./credential-file-guard.mjs";
import {
  parseProductionEnvironmentFile,
  validateProductionHttpsOriginList,
} from "./production-env-rules.mjs";

const CURRENT_CONFIG_VERSION = "0.2.0";
const LEGACY_SOURCE_VERSION = "0.1.1";
const MINIMUM_REMNASHOP_REVISION = 58n;
const POSTGRES_IDENTIFIER = /^[A-Za-z_][A-Za-z0-9_]{0,62}$/;
const ACTIVE_DATABASE_QUERY_PARAMETERS = new Set(["schema", "sslmode"]);
const LEGACY_DATABASE_QUERY_PARAMETERS = new Set([
  "application_name",
  "connect_timeout",
  "connection_limit",
  "idle_in_transaction_session_timeout",
  "pool_timeout",
  "statement_timeout",
]);
const LEGACY_DATABASE_SETTING_MAPPINGS = Object.freeze([
  Object.freeze({
    queryName: "statement_timeout",
    environmentName: "DATABASE_STATEMENT_TIMEOUT_MS",
    minimum: 250,
    maximum: 300_000,
  }),
  Object.freeze({
    queryName: "idle_in_transaction_session_timeout",
    environmentName: "DATABASE_IDLE_TRANSACTION_TIMEOUT_MS",
    minimum: 250,
    maximum: 300_000,
  }),
]);

function decoded(value) {
  try {
    return decodeURIComponent(value);
  } catch {
    return null;
  }
}

function invalidCredential(value) {
  return (
    typeof value !== "string"
    || value.length < 24
    || /change-me|changeme/i.test(value)
    || /[^\x20-\x7e]/.test(value)
  );
}

function inspectLegacySingleRoleDatabase(environment) {
  const database = environment.POSTGRES_DB;
  const role = environment.POSTGRES_USER;
  const password = environment.POSTGRES_PASSWORD;
  const rawUrl = environment.DATABASE_URL;
  if (!database || !role || !password || !rawUrl) {
    return Object.freeze({
      valid: false,
      reason: "POSTGRES_DB, POSTGRES_USER, POSTGRES_PASSWORD, and DATABASE_URL are required",
    });
  }
  if (!POSTGRES_IDENTIFIER.test(database)) {
    return Object.freeze({
      valid: false,
      reason: "POSTGRES_DB is not a valid PostgreSQL identifier",
    });
  }
  if (!POSTGRES_IDENTIFIER.test(role)) {
    return Object.freeze({
      valid: false,
      reason: "POSTGRES_USER is not a valid PostgreSQL identifier",
    });
  }
  if (invalidCredential(password)) {
    return Object.freeze({
      valid: false,
      reason: "POSTGRES_PASSWORD is not a valid non-placeholder credential",
    });
  }

  try {
    const url = new URL(rawUrl);
    if (
      !["postgres:", "postgresql:"].includes(url.protocol)
      || !url.hostname
      || decoded(url.username) !== role
      || decoded(url.password) !== password
      || decoded(url.pathname.replace(/^\//, "")) !== database
      || url.hash
    ) {
      return Object.freeze({
        valid: false,
        reason: "DATABASE_URL does not exactly use the legacy bootstrap database credential",
      });
    }
    const normalizedUrl = new URL(url);
    const queryEntries = [...url.searchParams.entries()];
    const seenQueryNames = new Set();
    normalizedUrl.search = "";
    for (const [rawQueryName, value] of queryEntries) {
      const queryName = rawQueryName.toLowerCase();
      if (
        seenQueryNames.has(queryName)
        || !(
          ACTIVE_DATABASE_QUERY_PARAMETERS.has(queryName)
          || LEGACY_DATABASE_QUERY_PARAMETERS.has(queryName)
        )
      ) {
        return Object.freeze({
          valid: false,
          reason: "DATABASE_URL contains invalid or duplicate query parameters",
        });
      }
      seenQueryNames.add(queryName);
      normalizedUrl.searchParams.append(queryName, value);
    }
    return Object.freeze({ valid: true, reason: null, url: normalizedUrl });
  } catch {
    return Object.freeze({
      valid: false,
      reason: "DATABASE_URL is not a valid PostgreSQL URL",
    });
  }
}

function legacySingleRoleDatabase(environment) {
  return inspectLegacySingleRoleDatabase(environment).valid;
}

function v011PreparationComplete(environment) {
  const minimumRevision = environment.REMNASHOP_MINIMUM_ALEMBIC_REVISION;
  return (
    environment.CLEAN_PAY_UPGRADE_SOURCE_VERSION === LEGACY_SOURCE_VERSION
    && environment.CLEAN_PAY_CONFIG_VERSION === CURRENT_CONFIG_VERSION
    && [
      "CLEAN_PAY_MIGRATION_IMAGE",
      "DATABASE_URL",
      "MIGRATION_DATABASE_URL",
      "RETENTION_DATABASE_URL",
      "HOLD_OPERATOR_DATABASE_URL",
      "PAYMENT_REDIRECT_ORIGINS",
      "REMNAWAVE_SUBSCRIPTION_ORIGINS",
      "WEB_REFRESH_KEY_ID",
    ].every((name) => Boolean(environment[name]))
    && [
      "CLEAN_PAY_DATABASE_ADOPT_EXISTING",
      "CLEAN_PAY_DATABASE_ADOPTION_BACKUP_CONFIRMED",
      "PAYMENT_DATA_RETENTION_ENABLED",
    ].every((name) => ["true", "false"].includes(environment[name]))
    && Boolean(minimumRevision)
    && /^\d{1,18}$/.test(minimumRevision)
    && BigInt(minimumRevision) >= MINIMUM_REMNASHOP_REVISION
  );
}

function hasV011UpgradeSignals(environment) {
  if (environment.CLEAN_PAY_UPGRADE_SOURCE_VERSION === LEGACY_SOURCE_VERSION) {
    return !v011PreparationComplete(environment);
  }
  if (legacySingleRoleDatabase(environment)) return true;

  const missingModernBoundary = [
    "CLEAN_PAY_MIGRATION_IMAGE",
    "MIGRATION_DATABASE_URL",
    "RETENTION_DATABASE_URL",
    "HOLD_OPERATOR_DATABASE_URL",
    "PAYMENT_REDIRECT_ORIGINS",
    "REMNAWAVE_SUBSCRIPTION_ORIGINS",
  ].some((name) => !environment[name]);
  return (
    missingModernBoundary
    && environment.REMNASHOP_MINIMUM_ALEMBIC_REVISION === "0050"
  );
}

function replaceAssignments(contents, updates) {
  const pending = new Map(Object.entries(updates));
  const lines = contents.replaceAll("\r\n", "\n").split("\n");
  const output = lines.map((line) => {
    const name = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=/.exec(line)?.[1];
    if (!name || !pending.has(name)) return line;
    const value = pending.get(name);
    pending.delete(name);
    return `${name}=${value}`;
  });
  if (output.at(-1) === "") output.pop();
  for (const [name, value] of pending) output.push(`${name}=${value}`);
  return `${output.join("\n")}\n`;
}

function sameOrigins(left, right) {
  const normalizedLeft = [...left].sort();
  const normalizedRight = [...right].sort();
  return (
    normalizedLeft.length === normalizedRight.length
    && normalizedLeft.every((origin, index) => origin === normalizedRight[index])
  );
}

function safeImageReference(value) {
  return (
    typeof value === "string"
    && value.length > 0
    && value.length <= 512
    && !/[\s\0\r\n$#]/.test(value)
  );
}

function setIfMissing(environment, updates, name, value) {
  if (!environment[name]) updates[name] = value;
}

function translatedLegacyDatabaseUpdates(environment, legacyDatabase) {
  if (!legacyDatabase.valid || !legacyDatabase.url) return Object.freeze({});
  const url = new URL(legacyDatabase.url);
  const updates = {};

  for (const {
    queryName,
    environmentName,
    minimum,
    maximum,
  } of LEGACY_DATABASE_SETTING_MAPPINGS) {
    const value = url.searchParams.get(queryName);
    if (value === null) continue;
    if (!/^(?:0|[1-9]\d*)$/.test(value)) {
      throw new Error(`${queryName} must be a canonical decimal integer`);
    }
    const numericValue = Number(value);
    if (
      !Number.isSafeInteger(numericValue)
      || numericValue < minimum
      || numericValue > maximum
    ) {
      throw new Error(
        `${queryName} must be between ${minimum} and ${maximum} milliseconds for v0.2.0`,
      );
    }
    if (
      environment[environmentName]
      && environment[environmentName] !== value
    ) {
      throw new Error(
        `${environmentName} conflicts with the legacy DATABASE_URL ${queryName} value`,
      );
    }
    if (!environment[environmentName]) updates[environmentName] = value;
  }

  for (const queryName of LEGACY_DATABASE_QUERY_PARAMETERS) {
    url.searchParams.delete(queryName);
  }
  if (url.toString() !== environment.DATABASE_URL) {
    updates.DATABASE_URL = url.toString();
  }
  return Object.freeze(updates);
}

export function assertV011UpgradePreparationNotRequired(path) {
  const { contents } = readPrivateCredentialFile(path, "production env");
  const environment = parseProductionEnvironmentFile(contents, path);
  if (hasV011UpgradeSignals(environment)) {
    throw new Error(
      "Clean Pay 0.1.1 configuration detected; run the explicit prepare-v0.1.1-upgrade command before init, build, migrate, or install",
    );
  }
  return Object.freeze({ ready: true });
}

export function prepareV011ProductionEnvironment(path, options = {}) {
  const { subscriptionOrigins, paymentRedirectOrigins, migrationImage } = options;
  const requestedOrigins = validateProductionHttpsOriginList(
    "REMNAWAVE_SUBSCRIPTION_ORIGINS",
    subscriptionOrigins,
  );
  const requestedPaymentRedirectOrigins = validateProductionHttpsOriginList(
    "PAYMENT_REDIRECT_ORIGINS",
    paymentRedirectOrigins,
  );
  if (!safeImageReference(migrationImage)) {
    throw new Error("migrationImage must be a nonempty safe image reference");
  }

  const { contents, metadata } = readPrivateCredentialFile(path, "production env");
  const environment = parseProductionEnvironmentFile(contents, path);
  const preparedUpgrade =
    environment.CLEAN_PAY_UPGRADE_SOURCE_VERSION === LEGACY_SOURCE_VERSION;
  const legacyDatabase = inspectLegacySingleRoleDatabase(environment);
  const databaseRolePreparationPending = [
    "MIGRATION_DATABASE_URL",
    "RETENTION_DATABASE_URL",
    "HOLD_OPERATOR_DATABASE_URL",
  ].some((name) => !environment[name]);
  if (!preparedUpgrade && !legacyDatabase.valid) {
    throw new Error(
      `the environment is not a valid unmodified v0.1.1 single-role database configuration: ${legacyDatabase.reason}`,
    );
  }
  if (preparedUpgrade && databaseRolePreparationPending && !legacyDatabase.valid) {
    throw new Error(
      `the interrupted v0.1.1 preparation cannot safely continue: ${legacyDatabase.reason}`,
    );
  }
  if (
    environment.CLEAN_PAY_UPGRADE_SOURCE_VERSION
    && !preparedUpgrade
  ) {
    throw new Error("CLEAN_PAY_UPGRADE_SOURCE_VERSION is not supported by this upgrader");
  }
  if (
    environment.CLEAN_PAY_CONFIG_VERSION
    && environment.CLEAN_PAY_CONFIG_VERSION !== CURRENT_CONFIG_VERSION
  ) {
    throw new Error("CLEAN_PAY_CONFIG_VERSION is not supported by this upgrader");
  }

  const existingOrigins = environment.REMNAWAVE_SUBSCRIPTION_ORIGINS
    ? validateProductionHttpsOriginList(
        "REMNAWAVE_SUBSCRIPTION_ORIGINS",
        environment.REMNAWAVE_SUBSCRIPTION_ORIGINS,
      )
    : null;
  if (existingOrigins && !sameOrigins(existingOrigins, requestedOrigins)) {
    throw new Error(
      "REMNAWAVE_SUBSCRIPTION_ORIGINS is already configured differently; refusing to overwrite it",
    );
  }
  const existingPaymentRedirectOrigins = environment.PAYMENT_REDIRECT_ORIGINS
    ? validateProductionHttpsOriginList(
        "PAYMENT_REDIRECT_ORIGINS",
        environment.PAYMENT_REDIRECT_ORIGINS,
      )
    : null;
  if (
    existingPaymentRedirectOrigins
    && !sameOrigins(
      existingPaymentRedirectOrigins,
      requestedPaymentRedirectOrigins,
    )
  ) {
    throw new Error(
      "PAYMENT_REDIRECT_ORIGINS is already configured differently; refusing to overwrite it",
    );
  }
  if (
    environment.CLEAN_PAY_MIGRATION_IMAGE
    && environment.CLEAN_PAY_MIGRATION_IMAGE !== migrationImage
  ) {
    throw new Error(
      "CLEAN_PAY_MIGRATION_IMAGE is already configured differently; refusing to overwrite it",
    );
  }

  const updates = {
    ...translatedLegacyDatabaseUpdates(environment, legacyDatabase),
  };
  setIfMissing(environment, updates, "CLEAN_PAY_CONFIG_VERSION", CURRENT_CONFIG_VERSION);
  setIfMissing(
    environment,
    updates,
    "CLEAN_PAY_UPGRADE_SOURCE_VERSION",
    LEGACY_SOURCE_VERSION,
  );
  setIfMissing(environment, updates, "CLEAN_PAY_DEPLOY_SOURCE", "build");
  setIfMissing(environment, updates, "CLEAN_PAY_MIGRATION_IMAGE", migrationImage);
  setIfMissing(environment, updates, "CLEAN_PAY_RELEASE", "local");
  setIfMissing(environment, updates, "CLEAN_PAY_REVISION", "local");
  setIfMissing(
    environment,
    updates,
    "CLEAN_PAY_DATABASE_ADOPT_EXISTING",
    "false",
  );
  setIfMissing(
    environment,
    updates,
    "CLEAN_PAY_DATABASE_ADOPTION_BACKUP_CONFIRMED",
    "false",
  );
  setIfMissing(
    environment,
    updates,
    "PAYMENT_DATA_RETENTION_ENABLED",
    "false",
  );
  setIfMissing(
    environment,
    updates,
    "PAYMENT_REDIRECT_ORIGINS",
    requestedPaymentRedirectOrigins.join(","),
  );
  setIfMissing(environment, updates, "WEB_REFRESH_KEY_ID", "primary");
  setIfMissing(
    environment,
    updates,
    "REMNAWAVE_SUBSCRIPTION_ORIGINS",
    requestedOrigins.join(","),
  );

  const minimumRevision = environment.REMNASHOP_MINIMUM_ALEMBIC_REVISION;
  if (minimumRevision && !/^\d{1,18}$/.test(minimumRevision)) {
    throw new Error("REMNASHOP_MINIMUM_ALEMBIC_REVISION must be numeric");
  }
  if (!minimumRevision || BigInt(minimumRevision) < MINIMUM_REMNASHOP_REVISION) {
    updates.REMNASHOP_MINIMUM_ALEMBIC_REVISION = "0058";
  }

  if (Object.keys(updates).length > 0) {
    const updatedContents = replaceAssignments(contents, updates);
    parseProductionEnvironmentFile(updatedContents, path);
    writePrivateCredentialFileCas(
      path,
      "production env",
      updatedContents,
      metadata,
      options,
    );
  }

  return Object.freeze({
    updatedNames: Object.freeze(Object.keys(updates).sort()),
  });
}

if (
  process.argv[1]
  && resolve(fileURLToPath(import.meta.url)) === resolve(process.argv[1])
) {
  try {
    const command = process.argv[2];
    const path = process.argv[3];
    if (command === "check" && process.argv.length === 4) {
      assertV011UpgradePreparationNotRequired(path);
      process.stdout.write("Production configuration does not require v0.1.1 preparation.\n");
    } else if (command === "prepare-v0.1.1" && process.argv.length === 7) {
      const result = prepareV011ProductionEnvironment(path, {
        subscriptionOrigins: process.argv[4],
        paymentRedirectOrigins: process.argv[5],
        migrationImage: process.argv[6],
      });
      process.stdout.write(
        result.updatedNames.length > 0
          ? `Prepared v0.1.1 environment fields: ${result.updatedNames.join(", ")}\n`
          : "The v0.1.1 environment is already prepared for v0.2.0.\n",
      );
    } else {
      throw new Error(
        "usage: production-environment-upgrade.mjs check ENV | prepare-v0.1.1 ENV SUBSCRIPTION_ORIGINS PAYMENT_REDIRECT_ORIGINS MIGRATION_IMAGE",
      );
    }
  } catch (error) {
    process.stderr.write(
      `Production environment upgrade failed: ${error instanceof Error ? error.message : String(error)}\n`,
    );
    process.exitCode = 1;
  }
}
