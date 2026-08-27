import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

const sessionMigration = readFileSync(
  "prisma/migrations/20260619153000_add_auth_cache_models/migration.sql",
  "utf8",
);
const telegramMigration = readFileSync(
  "prisma/migrations/20260619154500_add_telegram_oidc/migration.sql",
  "utf8",
);
const telegramTextMigration = readFileSync(
  "prisma/migrations/20260623214000_store_telegram_id_as_text/migration.sql",
  "utf8",
);
const remnashopRehearsal = readFileSync(
  "scripts/security/rehearse-remnashop-migrations.sh",
  "utf8",
);
const cleanPayRehearsal = readFileSync(
  "scripts/security/rehearse-clean-pay-migrations.sh",
  "utf8",
);
const ciWorkflow = readFileSync(".github/workflows/ci.yml", "utf8");
const rollbackVerifier = readFileSync(
  "deploy/prod/migration-rollback-verifier.mjs",
  "utf8",
);
const dockerfile = readFileSync("Dockerfile", "utf8");
const gitAttributes = readFileSync(".gitattributes", "utf8");
const currentSecurityMigrations = [
  "20260825010000_add_durable_telegram_callback",
  "20260825210000_add_payment_sensitive_retention",
  "20260825220000_add_payment_retention_hold_lifecycle",
  "20260825230000_guard_retention_mutations",
].map((name) => readFileSync(
  `prisma/migrations/${name}/migration.sql`,
  "utf8",
));

describe("production migration safety", () => {
  it("makes every new security migration atomic and bounds PostgreSQL waits", () => {
    expect(gitAttributes).toMatch(/^\*\.sql text eol=lf$/mu);
    for (const migration of currentSecurityMigrations) {
      const executableLines = migration
        .split(/\r?\n/u)
        .map((line) => line.trim())
        .filter((line) => line.length > 0 && !line.startsWith("--"));

      expect(executableLines[0]).toBe("BEGIN;");
      expect(executableLines.at(-1)).toBe("COMMIT;");
      expect(executableLines.filter((line) => line === "BEGIN;")).toHaveLength(1);
      expect(executableLines.filter((line) => line === "COMMIT;")).toHaveLength(1);
      expect(migration).toContain("SET LOCAL lock_timeout = '5s';");
      expect(migration).toContain("SET LOCAL statement_timeout = '15min';");
    }
  });

  it("backfills replacement WebSession expiries before enforcing NOT NULL", () => {
    const addColumns = sessionMigration.indexOf(
      'ADD COLUMN     "accessTokenExpiresAt" TIMESTAMP(3),',
    );
    const backfill = sessionMigration.indexOf('UPDATE "WebSession"');
    const enforceNotNull = sessionMigration.indexOf(
      'ALTER COLUMN "accessTokenExpiresAt" SET NOT NULL',
    );
    const dropLegacy = sessionMigration.indexOf(
      'ALTER TABLE "WebSession" DROP COLUMN "expiresAt"',
    );

    expect(addColumns).toBeGreaterThan(0);
    expect(backfill).toBeGreaterThan(addColumns);
    expect(enforceNotNull).toBeGreaterThan(backfill);
    expect(dropLegacy).toBeGreaterThan(enforceNotNull);
    expect(sessionMigration).toContain(
      'SET "accessTokenExpiresAt" = "expiresAt",',
    );
    expect(sessionMigration).toContain(
      '"refreshExpiresAt" = "expiresAt"',
    );
  });

  it("serializes legacy writers and makes the WebSession rewrite atomic", () => {
    expect(sessionMigration.trimStart().startsWith("BEGIN;")).toBe(true);
    expect(sessionMigration).toContain(
      'LOCK TABLE "WebSession" IN ACCESS EXCLUSIVE MODE;',
    );
    expect(sessionMigration.trimEnd().endsWith("COMMIT;")).toBe(true);
  });

  it("converts Telegram IDs in place and fails closed on malformed legacy data", () => {
    expect(telegramMigration).not.toContain('DROP COLUMN "telegramId"');
    expect(telegramMigration).not.toContain(
      'ADD COLUMN     "telegramId" BIGINT',
    );
    expect(telegramMigration).toContain(
      'ALTER COLUMN "telegramId" TYPE BIGINT USING "telegramId"::bigint',
    );
    expect(telegramMigration).toContain(
      "Telegram ID migration blocked: % malformed or out-of-range rows",
    );
    expect(telegramMigration).toContain(
      'LOCK TABLE "WebUser" IN ACCESS EXCLUSIVE MODE;',
    );
    expect(telegramMigration.trimStart().startsWith("BEGIN;")).toBe(true);
    expect(telegramMigration.trimEnd().endsWith("COMMIT;")).toBe(true);
    expect(telegramTextMigration).toContain(
      'TYPE TEXT USING "telegramId"::text',
    );
  });

  it("rehearses the reviewed non-empty Remnashop recovery sequence in CI", () => {
    expect(ciWorkflow).toContain("remnashop-migration-rehearsal:");
    expect(ciWorkflow).toContain("bash scripts/security/rehearse-clean-pay-migrations.sh");
    expect(ciWorkflow).toContain("bash scripts/security/rehearse-remnashop-migrations.sh");
    expect(remnashopRehearsal).toContain("837d964269078142307794ba3566a30d40b7b0b6");
    expect(remnashopRehearsal).toContain('migrate "$SOURCE_DATABASE" 0040');
    expect(remnashopRehearsal).toContain('migrate "$SOURCE_DATABASE" 0047');
    expect(remnashopRehearsal).toContain('migrate "$SOURCE_DATABASE" 0058');
    expect(remnashopRehearsal).toContain("pre-0040-backup.list");
    expect(remnashopRehearsal).toContain("post-0058-backup.list");
    expect(remnashopRehearsal).toContain(
      'docker rm --force --volumes "$POSTGRES_CONTAINER"',
    );
    expect(remnashopRehearsal).toContain('test "$(revision "$ROLLBACK_DATABASE")" = "0040"');
    expect(remnashopRehearsal).toContain("lock_timeout = '1500ms'");
    expect(remnashopRehearsal).toContain('test "$(revision "$LOCK_DATABASE")" = "0044"');
    expect(remnashopRehearsal).toContain('migrate "$LOCK_DATABASE" 0058');
    expect(remnashopRehearsal).toContain("payment_operations");
    expect(remnashopRehearsal).toContain("user_merge_audit");
    expect(remnashopRehearsal.indexOf('migrate "$SOURCE_DATABASE" 0047')).toBeLessThan(
      remnashopRehearsal.indexOf("INSERT INTO payment_operations"),
    );
    expect(remnashopRehearsal.indexOf("INSERT INTO payment_operations")).toBeLessThan(
      remnashopRehearsal.indexOf('migrate "$SOURCE_DATABASE" 0058'),
    );
    expect(remnashopRehearsal).toContain('migrate "$INVALID_OWNER_DATABASE" 0048');
    expect(remnashopRehearsal).toContain("migration 0048 blocked");
    expect(remnashopRehearsal).toContain("failed 0048 left partial owner-fencing triggers");
    expect(remnashopRehearsal).toContain('migrate "$ROW_LOCK_DATABASE" 0051');
    expect(remnashopRehearsal).toContain("payment_runtime_control WHERE id = 1 FOR UPDATE");
    expect(remnashopRehearsal).toContain("failed 0051 partially finalized the rollout gate");
    expect(remnashopRehearsal).toContain("application(); assert app.title");
    expect(remnashopRehearsal).toContain("from fastapi.testclient import TestClient");
    expect(remnashopRehearsal).toContain("/api/v1/public/auth/email/start");
    expect(remnashopRehearsal).toContain("/api/v1/public/auth/identify");
    expect(remnashopRehearsal).toContain("/api/v1/public/auth/service-session");
    expect(remnashopRehearsal).toContain(
      "/api/v1/public/auth/notification-preferences",
    );
    expect(remnashopRehearsal).toContain("statuses == [422, 422, 422, 405]");
    expect(remnashopRehearsal).toContain('"authApiContract"');
  });

  it("rehearses populated Clean Pay migrations and atomic failure recovery", () => {
    expect(cleanPayRehearsal).toContain("20260619145932_init");
    expect(cleanPayRehearsal).toContain("20260619153000_add_auth_cache_models");
    expect(cleanPayRehearsal).toContain("20260619154500_add_telegram_oidc");
    expect(cleanPayRehearsal).toContain("20260619161000_add_remnashop_session_tokens");
    expect(cleanPayRehearsal).toContain("20260717223000_add_payment_idempotency");
    expect(cleanPayRehearsal).toContain("20260718000000_add_payment_reconciliation");
    expect(cleanPayRehearsal).toContain("20260813090000_add_payment_owner_change_fence");
    expect(cleanPayRehearsal).toContain("20260813091000_add_remnashop_refresh_recovery");
    expect(cleanPayRehearsal).toContain("docker build --pull --target migration");
    for (const exactImageInput of [
      "CLEAN_PAY_REHEARSAL_EXTERNAL_MIGRATION_IMAGE",
      "CLEAN_PAY_REHEARSAL_EXPECTED_IMAGE_ID",
      "CLEAN_PAY_REHEARSAL_EXPECTED_REVISION",
      "CLEAN_PAY_REHEARSAL_EXPECTED_RELEASE",
      "CLEAN_PAY_REHEARSAL_EXPECTED_PUBLIC_BUILD_CONTRACT_VERSION",
      "CLEAN_PAY_REHEARSAL_EXPECTED_PUBLIC_BUILD_CONTRACT_SHA256",
    ]) {
      expect(cleanPayRehearsal).toContain(exactImageInput);
    }
    expect(cleanPayRehearsal).toContain(
      'fail "exact migration image inputs must be provided together"',
    );
    expect(cleanPayRehearsal).toContain(
      'test "$CLEAN_PAY_REHEARSAL_EXPECTED_REVISION" = "$CLEAN_PAY_REVISION"',
    );
    expect(cleanPayRehearsal).toContain("verify-rehearsal-migration-image.mjs");
    expect(cleanPayRehearsal).toContain("migration_image_owned=false");
    expect(cleanPayRehearsal).toContain('if [ "$migration_image_owned" = true ]; then');
    expect(cleanPayRehearsal).toContain(
      'migration_contract_migration_image="$CLEAN_PAY_REHEARSAL_EXTERNAL_MIGRATION_IMAGE"',
    );
    expect(cleanPayRehearsal).toContain('migration_deploy_source=pull');
    expect(cleanPayRehearsal).toContain(
      'docker rm --force --volumes "$POSTGRES_CONTAINER"',
    );
    expect(cleanPayRehearsal).toContain('node node_modules/prisma/build/index.js "$@"');
    expect(cleanPayRehearsal).toContain("MSYS_NO_PATHCONV=1 command docker");
    expect(cleanPayRehearsal).toContain('cygpath -w -- "$1"');
    expect(cleanPayRehearsal).toContain(
      '--mount "type=bind,source=$stage_mount_source,target=/app/prisma/migrations,readonly"',
    );
    expect(cleanPayRehearsal).toContain('migrate resolve --rolled-back "$migration_name"');
    expect(cleanPayRehearsal).toContain('FROM "_prisma_migrations"');
    expect(cleanPayRehearsal).not.toContain("clean_pay_rehearsal_state");
    expect(cleanPayRehearsal).toContain("fixture-session' FOR UPDATE");
    expect(cleanPayRehearsal).toContain("clean-pay-session-row-lock-server.log");
    expect(cleanPayRehearsal).toContain("canceling statement due to lock timeout");
    expect(cleanPayRehearsal).toContain("failed session rewrite left replacement columns");
    expect(cleanPayRehearsal).toContain("malformed-telegram-id");
    expect(cleanPayRehearsal).toContain("clean-pay-invalid-telegram-server.log");
    expect(cleanPayRehearsal).toContain(
      "Telegram ID migration blocked: 1 malformed or out-of-range rows",
    );
    expect(cleanPayRehearsal).toContain("failed Telegram migration left partial user columns");
    expect(cleanPayRehearsal).toContain("remnashopAccessTokenEncrypted");
    expect(cleanPayRehearsal).toContain("successorTokenEncrypted");
    expect(cleanPayRehearsal).toContain("remnashopRefreshRecoveryEncrypted");
    expect(cleanPayRehearsal).toContain("fixture-payment-operation");
    expect(cleanPayRehearsal).toContain("populated payment operation did not receive its reconciliation backfill");
    expect(cleanPayRehearsal).toContain("owner-fencing fixture changed before head");
    expect(cleanPayRehearsal).toContain('apply_through "$CLEAN_PAY_HEAD"');
    expect(cleanPayRehearsal).toContain('run_exact_migration_image "$EMPTY_DATABASE_NAME"');
    expect(cleanPayRehearsal).toContain('run_exact_migration_image "$DATABASE_NAME"');
    expect(cleanPayRehearsal).toContain('run_exact_migration_image "$RESTORE_DATABASE_NAME"');
    expect(cleanPayRehearsal).toContain('migrate status');
    expect(cleanPayRehearsal).toContain("clean-pay-pre-session-backup.list");

    const exactMigrationImage = cleanPayRehearsal.slice(
      cleanPayRehearsal.indexOf("run_exact_migration_image() {"),
      cleanPayRehearsal.indexOf("encrypted_session_state() {"),
    );
    expect(exactMigrationImage).toContain('--env DATABASE_URL="$(database_url "$database")"');
    expect(exactMigrationImage).toContain("--env CLEAN_PAY_RUNTIME_ROLE=migration");
    expect(exactMigrationImage).not.toMatch(/--env POSTGRES_(?:DB|USER|PASSWORD)=/);
  });

  it("routes exact zero-step migration recovery through the guarded migration image", () => {
    const deploy = readFileSync("deploy.sh", "utf8");
    const runbook = readFileSync("docs/production-migration-runbook.md", "utf8");
    const recovery = deploy.slice(
      deploy.indexOf("resolve_rolled_back_migration() {"),
      deploy.indexOf("up() {"),
    );

    expect(recovery).toContain("--confirm-zero-step-indexes-intact");
    expect(recovery).toContain("--confirm-atomic-zero-step-rollback");
    for (const migrationName of [
      "20260718141000_drop_redundant_indexes",
      "20260825010000_add_durable_telegram_callback",
      "20260825210000_add_payment_sensitive_retention",
      "20260825220000_add_payment_retention_hold_lifecycle",
      "20260825230000_guard_retention_mutations",
    ]) {
      expect(recovery).toContain(migrationName);
    }
    expect(recovery).toContain('prisma/migrations/$migration_name/migration.sql');
    expect(recovery).toContain("prepare_images");
    expect(recovery).toContain("preflight_images");
    expect(recovery).toContain("stop_runtime_services");
    expect(recovery).toContain("fence_database_roles");
    expect(recovery).toContain("recovery_preflight_database_roles");
    expect(deploy).toContain("database-role-provision.mjs recovery-preflight");
    expect(recovery).not.toContain("prepare_database_roles");
    expect(recovery).toContain("compose run --rm --no-deps --pull never migration");
    expect(recovery.match(/migration-rollback-verifier\.mjs/g)).toHaveLength(1);
    expect(recovery).toContain("migration-rollback-verifier.mjs resolve");
    expect(recovery).not.toContain("migrate resolve");
    expect(recovery).not.toContain("--rolled-back");
    expect(recovery).not.toContain("compose exec -T postgres");
    expect(rollbackVerifier).toContain("Expected exactly one unresolved failed migration ledger row");
    expect(rollbackVerifier).toContain("Failed migration left partial index changes");
    expect(rollbackVerifier).toContain("Required unique indexes are missing");
    expect(rollbackVerifier).toContain("applied_steps_count");
    expect(rollbackVerifier).toContain("migrationSqlChecksum");
    expect(rollbackVerifier).toContain("attempt.checksum !== expectedChecksum");
    expect(rollbackVerifier).toContain("hasFailureLog");
    expect(rollbackVerifier).toContain("BEGIN TRANSACTION ISOLATION LEVEL SERIALIZABLE");
    expect(rollbackVerifier).toContain("pg_advisory_xact_lock(72707369)");
    expect(rollbackVerifier).toContain("IN EXCLUSIVE MODE");
    expect(rollbackVerifier).toContain("WHERE id = $1");
    expect(rollbackVerifier).toContain("updateResult.rowCount !== 1");
    expect(rollbackVerifier).toContain("migrationLedgerFingerprint");
    expect(rollbackVerifier).toContain("CLEAN_PAY_RUNTIME_ROLE");
    expect(rollbackVerifier).toContain("DATABASE_URL");
    expect(dockerfile).toContain(
      "deploy/prod/migration-rollback-verifier.mjs ./deploy/prod/migration-rollback-verifier.mjs",
    );
    expect(runbook).toContain("./deploy.sh resolve-rolled-back");
    expect(runbook).toContain("only the four reviewed transactional migrations");
    expect(runbook).toContain("20260825230000_guard_retention_mutations");
    expect(runbook).toContain("./deploy.sh migrate");
    expect(runbook).not.toContain("node node_modules/prisma/build/index.js migrate resolve");
  });

  it("keeps backup and restore artifacts inside guarded private directories", () => {
    const runbook = readFileSync("docs/production-migration-runbook.md", "utf8");

    expect(runbook).toContain('test -d "$backup_dir" && test ! -L "$backup_dir"');
    expect(runbook).toContain('test ! -e "$backup_file" && test ! -L "$backup_file"');
    expect(runbook).toContain('( set -C; pg_dump "${source_conn[@]}"');
    expect(runbook).toContain('test ! -e "$backup_list" && test ! -L "$backup_list"');
    expect(runbook).toContain('test ! -e "$backup_checksum" && test ! -L "$backup_checksum"');
    expect(runbook).toContain('test ! -e "$restore_list" && test ! -L "$restore_list"');
    expect(runbook).toContain("( set -C; pg_restore --list");
    expect(runbook).toContain("( set -C; sha256sum");
    expect(runbook).toContain("export PGSSLMODE=\"$pg_sslmode\"");
    expect(runbook).toContain("export PGOPTIONS='-c search_path=pg_catalog'");
  });
});
