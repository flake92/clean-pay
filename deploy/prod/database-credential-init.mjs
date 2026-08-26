#!/usr/bin/env node

import { randomBytes } from "node:crypto";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  readPrivateCredentialFile,
  writePrivateCredentialFileCas,
} from "./credential-file-guard.mjs";
import { parseProductionEnvironmentFile } from "./production-env-rules.mjs";

const ROLE_URLS = Object.freeze([
  Object.freeze({ name: "DATABASE_URL", suffix: "app" }),
  Object.freeze({ name: "MIGRATION_DATABASE_URL", suffix: "migration" }),
  Object.freeze({ name: "RETENTION_DATABASE_URL", suffix: "retention" }),
  Object.freeze({ name: "HOLD_OPERATOR_DATABASE_URL", suffix: "hold" }),
]);
const KNOWN_BOOTSTRAP_PASSWORD_PLACEHOLDER = "change-me-bootstrap-database-password";
const KNOWN_ROLE_URL_PLACEHOLDERS = Object.freeze({
  DATABASE_URL: "postgresql://clean_pay_app:change-me-application-database-password@postgres:5432/clean_pay?schema=public",
  MIGRATION_DATABASE_URL: "postgresql://clean_pay_migration:change-me-migration-database-password@postgres:5432/clean_pay?schema=public",
  RETENTION_DATABASE_URL: "postgresql://clean_pay_retention:change-me-retention-database-password@postgres:5432/clean_pay?schema=public",
  HOLD_OPERATOR_DATABASE_URL: "postgresql://clean_pay_hold:change-me-hold-database-password@postgres:5432/clean_pay?schema=public",
});

function placeholder(value) {
  return typeof value !== "string"
    || value.length < 24
    || /change-me|changeme/i.test(value);
}

function generatedRoleName(database, suffix) {
  const normalized = database.replace(/[^A-Za-z0-9_]/g, "_") || "clean_pay";
  const roleSuffix = `_${suffix}`;
  return `${normalized.slice(0, 63 - roleSuffix.length)}${roleSuffix}`;
}

function parsedUrl(value) {
  try {
    const url = new URL(value);
    return ["postgres:", "postgresql:"].includes(url.protocol) ? url : null;
  } catch {
    return null;
  }
}

function decoded(value) {
  try {
    return decodeURIComponent(value);
  } catch {
    return "";
  }
}

function randomSecret() {
  return randomBytes(32).toString("hex");
}

function replaceAssignments(contents, updates) {
  const pending = new Map(Object.entries(updates));
  const lines = contents.replace(/\r\n/g, "\n").split("\n");
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

export function initializeDatabaseCredentials(path, options = {}) {
  const { contents, metadata } = readPrivateCredentialFile(path, "production env");
  const environment = parseProductionEnvironmentFile(contents, path);
  const database = environment.POSTGRES_DB;
  if (!database || !/^[A-Za-z_][A-Za-z0-9_]{0,62}$/.test(database)) {
    throw new Error("POSTGRES_DB is required and must be a PostgreSQL identifier");
  }
  const bootstrapRole = environment.POSTGRES_USER;
  if (!bootstrapRole || !/^[A-Za-z_][A-Za-z0-9_]{0,62}$/.test(bootstrapRole)) {
    throw new Error("POSTGRES_USER is required and must be a PostgreSQL identifier");
  }
  const roleStates = ROLE_URLS.map(({ name, suffix }) => {
    const value = environment[name];
    if (!value) return { name, state: "missing", suffix, url: null };
    if (value === KNOWN_ROLE_URL_PLACEHOLDERS[name]) {
      return { name, state: "placeholder", suffix, url: new URL(value) };
    }
    const url = parsedUrl(value);
    if (
      !url
      || !url.hostname
      || !url.pathname.replace(/^\//, "")
      || url.hash
      || decoded(url.pathname.replace(/^\//, "")) !== database
    ) {
      throw new Error(`${name} is nonempty but is not a valid URL for POSTGRES_DB`);
    }
    const queryNames = [...url.searchParams.keys()];
    if (
      queryNames.some((queryName) =>
        queryName !== queryName.toLowerCase()
        || !["schema", "sslmode"].includes(queryName)
      )
      || new Set(queryNames).size !== queryNames.length
    ) {
      throw new Error(`${name} contains invalid or duplicate query parameters`);
    }
    const role = decoded(url.username);
    const password = decoded(url.password);
    if (
      !/^[A-Za-z_][A-Za-z0-9_]{0,62}$/.test(role)
      || role === bootstrapRole
      || placeholder(password)
      || /[^\x20-\x7e]/.test(password)
    ) {
      throw new Error(`${name} contains an invalid non-placeholder role credential`);
    }
    return { name, password, role, state: "configured", suffix, url };
  });
  const configuredTargets = roleStates
    .filter(({ state }) => state === "configured")
    .map(({ url }) => JSON.stringify({
      host: url.hostname.toLowerCase(),
      port: url.port || "5432",
      protocol: url.protocol,
      schema: url.searchParams.get("schema") || "public",
      sslmode: url.searchParams.get("sslmode") || "",
    }));
  if (new Set(configuredTargets).size > 1) {
    throw new Error("configured role URLs must target the same database endpoint");
  }
  const baseUrl = roleStates.find(({ state }) => state === "configured")?.url
    ?? roleStates.find(({ state }) => state === "placeholder")?.url
    ?? new URL(
      `postgresql://placeholder:placeholder@postgres:5432/${encodeURIComponent(database)}?schema=public`,
    );
  const updates = {};
  if (
    !environment.POSTGRES_PASSWORD
    || environment.POSTGRES_PASSWORD === KNOWN_BOOTSTRAP_PASSWORD_PLACEHOLDER
  ) {
    updates.POSTGRES_PASSWORD = randomSecret();
  } else if (
    placeholder(environment.POSTGRES_PASSWORD)
    || /[^\x20-\x7e]/.test(environment.POSTGRES_PASSWORD)
  ) {
    throw new Error("POSTGRES_PASSWORD is nonempty but is not a valid credential or known placeholder");
  }
  const occupiedRoles = new Set([bootstrapRole]);
  const occupiedPasswords = new Set([
    updates.POSTGRES_PASSWORD ?? environment.POSTGRES_PASSWORD,
  ]);
  for (const roleState of roleStates) {
    const { name, suffix } = roleState;
    if (roleState.state === "configured") {
      if (
        occupiedRoles.has(roleState.role)
        || occupiedPasswords.has(roleState.password)
      ) {
        throw new Error("existing database role names and passwords must be pairwise distinct");
      }
      occupiedRoles.add(roleState.role);
      occupiedPasswords.add(roleState.password);
      continue;
    }
    const url = new URL(baseUrl);
    url.pathname = `/${encodeURIComponent(database)}`;
    let role = generatedRoleName(database, suffix);
    if (occupiedRoles.has(role)) role = generatedRoleName(`clean_pay_${database}`, suffix);
    const password = randomSecret();
    url.username = role;
    url.password = password;
    updates[name] = url.toString();
    occupiedRoles.add(role);
    occupiedPasswords.add(password);
  }
  if (Object.keys(updates).length > 0) {
    writePrivateCredentialFileCas(
      path,
      "production env",
      replaceAssignments(contents, updates),
      metadata,
      options,
    );
  }
  return Object.freeze({ updatedNames: Object.freeze(Object.keys(updates).sort()) });
}

if (
  process.argv[1]
  && resolve(fileURLToPath(import.meta.url)) === resolve(process.argv[1])
) {
  try {
    if (process.argv.length !== 4 || process.argv[2] !== "init") {
      throw new Error("usage: database-credential-init.mjs init PRODUCTION_ENV");
    }
    const result = initializeDatabaseCredentials(process.argv[3]);
    process.stdout.write(
      result.updatedNames.length > 0
        ? `Generated database credentials: ${result.updatedNames.join(", ")}\n`
        : "Database credentials already use five distinct identities.\n",
    );
  } catch (error) {
    process.stderr.write(
      `Database credential initialization failed: ${error instanceof Error ? error.message : String(error)}\n`,
    );
    process.exitCode = 1;
  }
}
