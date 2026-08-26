#!/usr/bin/env node

import { createHash, randomUUID } from "node:crypto";

import { PrismaPg } from "@prisma/adapter-pg";
import { Prisma, PrismaClient } from "@prisma/client";
import pg from "pg";

import {
  DATABASE_ENUM_TYPES,
  DATABASE_FUNCTIONS,
  DATABASE_INTERNAL_TABLES,
  DATABASE_TABLE_COLUMNS,
  DATABASE_TABLES,
} from "../../deploy/prod/database-privilege-manifest.mjs";

const { Client } = pg;

function required(name) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
}

function quotedIdentifier(value) {
  if (!/^[A-Za-z_][A-Za-z0-9_]{0,62}$/.test(value)) {
    throw new Error(`unsafe PostgreSQL identifier ${value}`);
  }
  return `"${value.replaceAll('"', '""')}"`;
}

function roleUrl(name) {
  const raw = required(name);
  const parsed = new URL(raw);
  const schema = parsed.searchParams.get("schema") ?? "public";
  return Object.freeze({ raw, schema, username: decodeURIComponent(parsed.username) });
}

async function connected(role, work) {
  const client = new Client({
    application_name: `clean-pay-ci-${role.username}`,
    connectionString: role.raw,
    connectionTimeoutMillis: 5_000,
    options: "-c search_path=pg_catalog",
    statement_timeout: 5_000,
  });
  await client.connect();
  try {
    const identity = await client.query("SELECT current_user AS role");
    if (identity.rows[0]?.role !== role.username) {
      throw new Error(`connected as unexpected role ${identity.rows[0]?.role}`);
    }
    await client.query(
      "SELECT pg_catalog.set_config('search_path', pg_catalog.format('pg_catalog, %I', $1::text), false)",
      [role.schema],
    );
    await work(client, quotedIdentifier(role.schema));
  } finally {
    await client.end();
  }
}

async function verifyApplicationPrismaWrites(role) {
  const suffix = randomUUID();
  const digest = (label) => createHash("sha256")
    .update(`${label}:${suffix}`)
    .digest("hex");
  const prisma = new PrismaClient({
    adapter: new PrismaPg(
      { connectionString: role.raw },
      { schema: role.schema },
    ),
  });
  const rollbackSentinel = new Error("expected application ACL probe rollback");

  try {
    await prisma.$transaction(async (tx) => {
      const user = await tx.webUser.create({
        data: {
          telegramId: `acl-probe-${suffix}`,
          telegramUsername: "acl_probe",
          fullName: "ACL Probe",
          displayName: "ACL Probe",
          lastLoginAt: new Date(),
        },
      });
      await tx.accountMergeConfirmation.create({
        data: {
          userId: user.id,
          tokenHash: digest("merge-token"),
          telegramId: `acl-probe-${suffix}`,
          targetEmail: `acl-probe-${suffix}@example.test`,
          sourceRemnashopUserId: `acl-probe-source-${suffix}`,
          targetRemnashopUserId: `acl-probe-target-${suffix}`,
          expiresAt: new Date(Date.now() + 600_000),
        },
      });
      await tx.paymentHistorySyncState.upsert({
        where: { userId: user.id },
        create: { userId: user.id, upstreamOwnerHash: digest("owner") },
        update: {},
      });
      const operation = await tx.paymentOperation.create({
        data: {
          userId: user.id,
          kind: "PURCHASE",
          idempotencyKeyHash: digest("idempotency"),
          requestFingerprint: digest("request"),
          requestPayload: {},
          upstreamKey: `acl-probe-upstream-${suffix}`,
        },
      });
      const record = await tx.paymentRecord.create({
        data: {
          userId: user.id,
          paymentId: `acl-probe-payment-${suffix}`,
          purchaseType: "PURCHASE",
          status: "PENDING",
          finalAmount: "10.00",
          currency: "USD",
          gatewayType: "ACL_PROBE",
          operationId: operation.id,
          upstreamCreatedAt: new Date(),
          upstreamUpdatedAt: new Date(),
          lastSyncedAt: new Date(),
        },
      });
      const retainedCases = await tx.$queryRaw(
        Prisma.sql`
          SELECT EXISTS (
            SELECT 1
            FROM "PaymentRetentionHold" AS hold
            WHERE hold."status" IN (
              'ACTIVE'::"PaymentRetentionHoldStatus",
              'RELEASED'::"PaymentRetentionHoldStatus"
            )
              AND (
                hold."caseOperationId" = ${operation.id}
                OR hold."casePaymentRecordId" = ${record.id}
              )
          ) AS "retained"
        `,
      );
      if (retainedCases.length !== 1 || retainedCases[0]?.retained !== false) {
        throw new Error("application retained-case ACL probe returned an invalid result");
      }
      await tx.telegramAuthState.create({
        data: {
          stateHash: digest("state"),
          nonceHash: digest("nonce"),
          codeVerifierHash: digest("verifier"),
          userId: user.id,
          expiresAt: new Date(Date.now() + 600_000),
        },
      });
      await tx.webAuthnChallenge.create({
        data: {
          challenge: `acl-probe-challenge-${suffix}`,
          type: "REGISTRATION",
          userId: user.id,
          expiresAt: new Date(Date.now() + 600_000),
        },
      });
      await tx.webAuthnCredential.create({
        data: {
          userId: user.id,
          credentialId: `acl-probe-credential-${suffix}`,
          publicKey: Buffer.from("acl-probe-public-key"),
          counter: 0n,
          transports: [],
          backedUp: false,
        },
      });
      const session = await tx.webSession.create({
        data: {
          userId: user.id,
          refreshTokenHash: digest("refresh"),
          authMethod: "TELEGRAM",
          assuranceLevel: "FULL",
          accessTokenExpiresAt: new Date(Date.now() + 600_000),
          refreshExpiresAt: new Date(Date.now() + 3_600_000),
        },
      });
      await tx.webRefreshToken.create({
        data: {
          sessionId: session.id,
          tokenHash: digest("refresh-history"),
          successorTokenEncrypted: "acl-probe-encrypted-successor",
          graceExpiresAt: new Date(Date.now() + 600_000),
          consumedAt: new Date(),
        },
      });
      const auditInsert = await tx.auditLog.createMany({
        data: {
          userId: user.id,
          action: "acl_probe",
          severity: "INFO",
          metadata: { synthetic: true },
        },
      });
      if (auditInsert.count !== 1) {
        throw new Error("application audit append ACL probe did not insert one row");
      }
      const auditUpdate = await tx.auditLog.updateMany({
        where: { userId: user.id },
        data: { userId: null },
      });
      if (auditUpdate.count !== 1) {
        throw new Error("application audit reference ACL probe did not update one row");
      }
      const deletedEmailCodes = await tx.emailVerificationCode.deleteMany({
        where: { userId: user.id },
      });
      if (deletedEmailCodes.count !== 0) {
        throw new Error("application email-code ACL probe found unexpected rows");
      }
      const holdReferenceUpdate = await tx.paymentRetentionHold.updateMany({
        where: { caseUserId: user.id, status: "ACTIVE" },
        data: { caseUserId: user.id },
      });
      if (holdReferenceUpdate.count !== 0) {
        throw new Error("application hold-reference ACL probe found unexpected rows");
      }
      throw rollbackSentinel;
    });
    throw new Error("application ACL probe unexpectedly committed");
  } catch (error) {
    if (error !== rollbackSentinel) {
      throw new Error(
        `application Prisma write ACL probe failed: ${error instanceof Error ? error.message : String(error)}`,
        { cause: error },
      );
    }
  } finally {
    await prisma.$disconnect();
  }
}

async function allowed(client, sql, label) {
  try {
    await client.query(sql);
  } catch (error) {
    throw new Error(`${label} should be allowed but failed: ${error instanceof Error ? error.message : String(error)}`);
  }
}

async function denied(client, sql, label) {
  try {
    await client.query(sql);
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "42501") return;
    throw new Error(`${label} failed for an unexpected reason: ${error instanceof Error ? error.message : String(error)}`);
  }
  throw new Error(`${label} unexpectedly succeeded`);
}

function exactArray(actual, expected, label) {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(`${label} mismatch: expected ${JSON.stringify(expected)}, received ${JSON.stringify(actual)}`);
  }
}

async function verifyExactFunctionExecution(client, schema, roleKey) {
  const expected = DATABASE_FUNCTIONS
    .filter(({ executeRoles }) => executeRoles.includes(roleKey))
    .map(({ identityArguments, name }) => `${name}(${identityArguments})`)
    .sort();
  const result = await client.query(
    `SELECT p.proname AS name,
            pg_catalog.pg_get_function_identity_arguments(p.oid) AS identity_arguments
       FROM pg_catalog.pg_proc AS p
       JOIN pg_catalog.pg_namespace AS n ON n.oid = p.pronamespace
      WHERE n.nspname = $1::text
        AND pg_catalog.has_function_privilege(
          CURRENT_USER,
          p.oid,
          'EXECUTE'
        )
      ORDER BY p.proname, identity_arguments`,
    [schema],
  );
  const actual = result.rows
    .map(({ identity_arguments: identityArguments, name }) =>
      `${name}(${identityArguments})`
    )
    .sort();
  exactArray(actual, expected, `${roleKey} executable target functions`);
}

async function verifyRetentionHasNoDirectObjectAccess(client, schemaName, schema) {
  for (const table of [...DATABASE_INTERNAL_TABLES, ...DATABASE_TABLES]) {
    const qualifiedName = `${quotedIdentifier(schemaName)}.${quotedIdentifier(table)}`;
    const privileges = await client.query(
      `SELECT
         pg_catalog.has_table_privilege(CURRENT_USER, $1::text, 'SELECT')
           OR pg_catalog.has_any_column_privilege(CURRENT_USER, $1::text, 'SELECT') AS can_select,
         pg_catalog.has_table_privilege(CURRENT_USER, $1::text, 'INSERT')
           OR pg_catalog.has_any_column_privilege(CURRENT_USER, $1::text, 'INSERT') AS can_insert,
         pg_catalog.has_table_privilege(CURRENT_USER, $1::text, 'UPDATE')
           OR pg_catalog.has_any_column_privilege(CURRENT_USER, $1::text, 'UPDATE') AS can_update,
         pg_catalog.has_table_privilege(CURRENT_USER, $1::text, 'DELETE') AS can_delete,
         pg_catalog.has_table_privilege(CURRENT_USER, $1::text, 'TRUNCATE') AS can_truncate,
         pg_catalog.has_table_privilege(CURRENT_USER, $1::text, 'REFERENCES')
           OR pg_catalog.has_any_column_privilege(CURRENT_USER, $1::text, 'REFERENCES') AS can_reference,
         pg_catalog.has_table_privilege(CURRENT_USER, $1::text, 'TRIGGER') AS can_trigger,
         pg_catalog.has_table_privilege(CURRENT_USER, $1::text, 'MAINTAIN') AS can_maintain`,
      [qualifiedName],
    );
    const row = privileges.rows[0];
    if (
      !row
      || row.can_select
      || row.can_insert
      || row.can_update
      || row.can_delete
      || row.can_truncate
      || row.can_reference
      || row.can_trigger
      || row.can_maintain
    ) {
      throw new Error(`retention direct privileges unexpectedly exist on ${qualifiedName}`);
    }

    const qualifiedTable = `${schema}.${quotedIdentifier(table)}`;
    const firstColumn = quotedIdentifier(DATABASE_TABLE_COLUMNS[table][0]);
    await denied(client, `SELECT * FROM ${qualifiedTable} LIMIT 0`, `retention ${table} SELECT`);
    await denied(client, `UPDATE ${qualifiedTable} SET ${firstColumn} = ${firstColumn} WHERE false`, `retention ${table} UPDATE`);
    await denied(client, `DELETE FROM ${qualifiedTable} WHERE false`, `retention ${table} DELETE`);
    await denied(client, `INSERT INTO ${qualifiedTable} DEFAULT VALUES`, `retention ${table} INSERT`);
    await denied(client, `TRUNCATE ${qualifiedTable}`, `retention ${table} TRUNCATE`);
  }

  for (const type of DATABASE_ENUM_TYPES) {
    const privilege = await client.query(
      "SELECT pg_catalog.has_type_privilege(CURRENT_USER, $1::text, 'USAGE') AS allowed",
      [`${quotedIdentifier(schemaName)}.${quotedIdentifier(type)}`],
    );
    if (privilege.rows[0]?.allowed !== false) {
      throw new Error(`retention enum USAGE unexpectedly exists on ${schemaName}.${type}`);
    }
  }
}

async function verifyNoDatabaseEscape(client, schema, role) {
  await denied(client, `CREATE SCHEMA "forbidden_${role}"`, `${role} database CREATE`);
  await denied(client, `CREATE TEMP TABLE "forbidden_${role}" (id int)`, `${role} database TEMP`);
  await denied(client, `CREATE TABLE ${schema}."forbidden_${role}" (id int)`, `${role} target DDL`);
}

async function main() {
  const application = roleUrl("DATABASE_URL");
  const migration = roleUrl("MIGRATION_DATABASE_URL");
  const retention = roleUrl("RETENTION_DATABASE_URL");
  const hold = roleUrl("HOLD_OPERATOR_DATABASE_URL");

  await connected(application, async (client, schema) => {
    await allowed(client, `SELECT "userId" FROM ${schema}."AuditLog" LIMIT 0`, "application AuditLog user reference");
    await denied(client, `SELECT "action" FROM ${schema}."AuditLog" LIMIT 0`, "application AuditLog payload read");
    await denied(client, `SELECT * FROM ${schema}."PaymentRetentionHold" LIMIT 0`, "application hold evidence read");
    await denied(client, `SELECT * FROM ${schema}."_prisma_migrations" LIMIT 0`, "application migration ledger read");
    await denied(client, `TRUNCATE ${schema}."WebUser"`, "application truncate");
    await verifyExactFunctionExecution(client, application.schema, "application");
    await verifyNoDatabaseEscape(client, schema, "application");
  });
  await verifyApplicationPrismaWrites(application);

  await connected(retention, async (client, schema) => {
    await verifyRetentionHasNoDirectObjectAccess(
      client,
      retention.schema,
      schema,
    );
    await verifyExactFunctionExecution(client, retention.schema, "retention");
    await allowed(
      client,
      `SELECT * FROM ${schema}."clean_pay_retention_delete_batch"('rateLimitEvents'::text)`,
      "guarded retention delete",
    );
    await allowed(
      client,
      `SELECT * FROM ${schema}."clean_pay_retention_scrub_telegram_callbacks"()`,
      "guarded callback scrub",
    );
    await allowed(
      client,
      `SELECT * FROM ${schema}."clean_pay_retention_scrub_payment_records"()`,
      "guarded payment record scrub",
    );
    await allowed(
      client,
      `SELECT * FROM ${schema}."clean_pay_retention_scrub_payment_operation_snapshots"()`,
      "guarded payment operation scrub",
    );
    try {
      await client.query(
        `SELECT * FROM ${schema}."clean_pay_retention_delete_batch"('forbidden_phase'::text)`,
      );
      throw new Error("guarded retention delete accepted an unknown phase");
    } catch (error) {
      if (
        error instanceof Error
        && "code" in error
        && error.code === "22023"
      ) {
        // Exact finite dispatch rejection is expected.
      } else {
        throw error;
      }
    }
    await verifyNoDatabaseEscape(client, schema, "retention");
  });

  await connected(hold, async (client, schema) => {
    await allowed(client, `SELECT id, "userId", "retentionHoldId", "retentionHoldAt" FROM ${schema}."PaymentOperation" LIMIT 0`, "hold operator case lookup");
    await denied(client, `SELECT "requestPayload" FROM ${schema}."PaymentOperation" LIMIT 0`, "hold operator payment payload read");
    await denied(client, `DELETE FROM ${schema}."PaymentRetentionHold" WHERE false`, "hold operator delete");
    await allowed(
      client,
      `INSERT INTO ${schema}."PaymentRetentionHold" (
         "id", "holdIdHash", "status", "selectorKind", "selectorId",
         "selectorEvidenceHash", "activeCaseKey", "caseUserId",
         "caseOperationId", "casePaymentRecordId", "owner", "reason",
         "reviewAt", "heldAt", "createdAt", "updatedAt"
       )
       SELECT
         'acl-probe-hold', repeat('4', 64), 'ACTIVE', 'PAYMENT_OPERATION',
         'acl-probe-operation', repeat('5', 64), repeat('6', 64),
         'acl-probe-user', 'acl-probe-operation', NULL, 'acl-probe',
         'synthetic', clock_timestamp() + interval '1 day', clock_timestamp(),
         clock_timestamp(), clock_timestamp()
       WHERE false
       RETURNING *`,
      "hold operator Prisma-shaped insert",
    );
    await verifyExactFunctionExecution(client, hold.schema, "holdOperator");
    await verifyNoDatabaseEscape(client, schema, "hold_operator");
  });

  const migrationClient = new Client({
    connectionString: migration.raw,
    connectionTimeoutMillis: 3_000,
    options: "-c search_path=pg_catalog",
  });
  try {
    await migrationClient.connect();
  } catch {
    process.stdout.write("Verified exact runtime database privileges and fenced migration login.\n");
    return;
  } finally {
    await migrationClient.end().catch(() => undefined);
  }
  throw new Error("migration owner LOGIN unexpectedly remained enabled after grant sync");
}

main().catch((error) => {
  process.stderr.write(
    `Database runtime privilege verification failed: ${error instanceof Error ? error.message : String(error)}\n`,
  );
  process.exitCode = 1;
});
