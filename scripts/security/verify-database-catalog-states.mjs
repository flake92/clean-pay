#!/usr/bin/env node

import { createHash, randomBytes } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

import pg from "pg";

import {
  DATABASE_PG17_SYSTEM_PUBLIC_ACL_SHA256,
  DATABASE_RECOVERY_PREDECESSOR_STATES,
  DATABASE_REVIEWED_CATALOG_STATES,
} from "../../deploy/prod/database-privilege-manifest.mjs";
import {
  buildCanonicalCatalogSnapshot,
  canonicalCatalogFingerprint,
  readSystemPublicAclSurface,
  systemPublicAclFingerprint,
} from "../../deploy/prod/database-role-provision.mjs";

const { Client } = pg;
const migrationsDirectory = resolve("prisma/migrations");

function required(name) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
}

function identifier(value) {
  if (!/^[a-z_][a-z0-9_]{0,62}$/.test(value)) {
    throw new Error(`unsafe PostgreSQL identifier ${value}`);
  }
  return `"${value}"`;
}

function migrationPlan() {
  return readdirSync(migrationsDirectory, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map(({ name }) => {
      const sql = readFileSync(resolve(migrationsDirectory, name, "migration.sql"));
      const text = sql.toString("utf8");
      if (text.includes("\r")) throw new Error(`${name} migration is not exact LF`);
      return Object.freeze({
        checksum: createHash("sha256").update(sql).digest("hex"),
        name,
        text,
      });
    })
    .sort((left, right) => left.name.localeCompare(right.name));
}

function deterministicUuid(name) {
  const hex = createHash("sha256").update(name).digest("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-a${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}

function expectedStates() {
  const states = { ...DATABASE_REVIEWED_CATALOG_STATES };
  for (const { predecessor, fingerprint } of Object.values(
    DATABASE_RECOVERY_PREDECESSOR_STATES,
  )) {
    const existing = states[predecessor];
    if (existing && existing !== fingerprint) {
      throw new Error(`catalog manifest disagrees for predecessor ${predecessor}`);
    }
    states[predecessor] = fingerprint;
  }
  return states;
}

async function reviewedSystemPublicAclFingerprint(client, schema) {
  const siblingDatabases = await client.query(
    "SELECT datname FROM pg_catalog.pg_database WHERE datname <> pg_catalog.current_database() ORDER BY datname",
  );
  for (const { datname } of siblingDatabases.rows) {
    await client.query(`REVOKE ALL PRIVILEGES ON DATABASE ${identifier(datname)} FROM PUBLIC`);
  }
  if (schema !== "public") {
    await client.query("REVOKE ALL PRIVILEGES ON SCHEMA public FROM PUBLIC");
  }
  const largeObjectFunctions = await client.query(`
    SELECT function.proname AS name,
           pg_catalog.pg_get_function_identity_arguments(function.oid) AS identity_arguments
      FROM pg_catalog.pg_proc function
      JOIN pg_catalog.pg_namespace namespace ON namespace.oid = function.pronamespace
     WHERE namespace.nspname = 'pg_catalog'
       AND function.proname = ANY($1::text[])
     ORDER BY function.proname,
              pg_catalog.pg_get_function_identity_arguments(function.oid)
  `, [[
    "lo_create", "lo_creat", "lo_export", "lo_from_bytea", "lo_import", "lo_open",
    "lo_put", "lo_truncate", "lo_truncate64", "lo_unlink", "lowrite",
  ]]);
  for (const fn of largeObjectFunctions.rows) {
    await client.query(
      `REVOKE EXECUTE ON FUNCTION pg_catalog.${identifier(fn.name)}(${fn.identity_arguments}) FROM PUBLIC`,
    );
  }
  return systemPublicAclFingerprint(
    await readSystemPublicAclSurface(client, schema),
  );
}

async function replaySchema(adminUrl, schema, suffix, { verify }) {
  const database = `clean_pay_catalog_${suffix}_${randomBytes(6).toString("hex")}`;
  const admin = new Client({
    connectionString: adminUrl,
    options: "-c search_path=pg_catalog",
  });
  await admin.connect();
  let target;
  try {
    await admin.query(`
      CREATE DATABASE ${identifier(database)}
      WITH TEMPLATE template0 ENCODING 'UTF8'
           LOCALE_PROVIDER libc LC_COLLATE 'C' LC_CTYPE 'C.UTF-8'
    `);
    const targetUrl = new URL(adminUrl);
    targetUrl.pathname = `/${database}`;
    target = new Client({
      connectionString: targetUrl.toString(),
      options: "-c search_path=pg_catalog",
    });
    await target.connect();
    if (schema !== "public") {
      await target.query(`CREATE SCHEMA ${identifier(schema)}`);
    }
    const systemPublicAcl = await reviewedSystemPublicAclFingerprint(target, schema);
    if (verify && systemPublicAcl !== DATABASE_PG17_SYSTEM_PUBLIC_ACL_SHA256) {
      throw new Error(
        `${schema} system PUBLIC ACL expected ${DATABASE_PG17_SYSTEM_PUBLIC_ACL_SHA256} but got ${systemPublicAcl}`,
      );
    }
    const actual = {};
    const snapshot = async (name) => {
      await target.query(
        "SELECT pg_catalog.set_config('search_path', pg_catalog.format('pg_catalog, %I', $1::text), false)",
        [schema],
      );
      actual[name] = canonicalCatalogFingerprint(
        await buildCanonicalCatalogSnapshot(target, schema),
      );
    };
    const migrationSearchPath = `${identifier(schema)}, pg_catalog`;
    await snapshot("EMPTY");
    await target.query(`SELECT pg_catalog.set_config('search_path', $1, false)`, [
      migrationSearchPath,
    ]);
    await target.query(`
      CREATE TABLE "_prisma_migrations" (
        "id" VARCHAR(36) NOT NULL,
        "checksum" VARCHAR(64) NOT NULL,
        "finished_at" TIMESTAMPTZ,
        "migration_name" VARCHAR(255) NOT NULL,
        "logs" TEXT,
        "rolled_back_at" TIMESTAMPTZ,
        "started_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        "applied_steps_count" INTEGER NOT NULL DEFAULT 0,
        CONSTRAINT "_prisma_migrations_pkey" PRIMARY KEY ("id")
      )
    `);
    await snapshot("LEDGER_ONLY");
    const expected = expectedStates();
    for (const migration of migrationPlan()) {
      await target.query(`SELECT pg_catalog.set_config('search_path', $1, false)`, [
        migrationSearchPath,
      ]);
      await target.query("BEGIN");
      try {
        await target.query(migration.text);
        await target.query(
          `INSERT INTO ${identifier(schema)}."_prisma_migrations"
             (id, checksum, migration_name, started_at, finished_at, applied_steps_count)
           VALUES ($1, $2, $3, clock_timestamp(), clock_timestamp(), 1)`,
          [deterministicUuid(migration.name), migration.checksum, migration.name],
        );
        await target.query("COMMIT");
      } catch (error) {
        await target.query("ROLLBACK");
        throw error;
      }
      if (Object.hasOwn(expected, migration.name)) await snapshot(migration.name);
    }
    if (verify) {
      for (const [name, expectedFingerprint] of Object.entries(expected)) {
        if (!/^[0-9a-f]{64}$/.test(expectedFingerprint)) {
          throw new Error(`catalog state ${name} does not have a generated SHA-256 fingerprint`);
        }
        if (actual[name] !== expectedFingerprint) {
          throw new Error(
            `${schema} catalog state ${name} expected ${expectedFingerprint} but got ${actual[name]}`,
          );
        }
      }
    }
    return { states: actual, systemPublicAcl };
  } finally {
    if (target) await target.end();
    await admin.query(`DROP DATABASE ${identifier(database)} WITH (FORCE)`);
    await admin.end();
  }
}

try {
  const [mode, ...extra] = process.argv.slice(2);
  if (extra.length > 0 || (mode !== undefined && mode !== "--print")) {
    throw new Error("usage: verify-database-catalog-states.mjs [--print]");
  }
  const verify = mode !== "--print";
  const adminUrl = required("DATABASE_CATALOG_ADMIN_URL");
  const parsed = new URL(adminUrl);
  if (!/[\/]postgres$/.test(parsed.pathname) || !["postgres:", "postgresql:"].includes(parsed.protocol)) {
    throw new Error("DATABASE_CATALOG_ADMIN_URL must target the postgres maintenance database");
  }
  const publicResult = await replaySchema(adminUrl, "public", "public", { verify });
  const customResult = await replaySchema(adminUrl, "clean_pay_app", "custom", { verify });
  if (JSON.stringify(publicResult) !== JSON.stringify(customResult)) {
    throw new Error("public and custom schema catalog fingerprints differ");
  }
  process.stdout.write(verify
    ? `Verified ${Object.keys(publicResult.states).length} PostgreSQL 17 catalog states and the exact system PUBLIC ACL in public and custom schemas.\n`
    : `${JSON.stringify({
      catalogStates: publicResult.states,
      systemPublicAclSha256: publicResult.systemPublicAcl,
    }, null, 2)}\n`);
} catch (error) {
  process.stderr.write(
    `Database catalog state verification failed: ${error instanceof Error ? error.message : String(error)}\n`,
  );
  process.exitCode = 1;
}
