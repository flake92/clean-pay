import { readFileSync } from "node:fs";
import { PassThrough } from "node:stream";

import { describe, expect, it, vi } from "vitest";

import {
  assertPaymentRetentionHoldRuntimeEnvironment,
  readBoundedJson,
} from "../../../deploy/prod/payment-retention-hold-command.mjs";
import {
  disposePaymentRetentionHold,
  placePaymentRetentionHold,
  releasePaymentRetentionHold,
} from "../../../deploy/prod/payment-retention-hold.mjs";

const HOLD_A = "018f47a2-4b11-4f87-8f8c-22e309a20f1a";
const HOLD_B = "018f47a2-4b11-4f87-9f8c-22e309a20f1b";
const REVIEW_AT = "2026-09-02T00:00:00.000Z";

type MutableRow = {
  id: string;
  userId: string;
  retentionHoldAt: Date | null;
  retentionHoldId: string | null;
  paymentRecord?: MutableRow | null;
  operation?: MutableRow | null;
};

type MutableHold = Record<string, unknown> & { id: string };
type UpdateArguments = {
  where: Record<string, unknown>;
  data: Record<string, unknown>;
};

function matches(row: Record<string, unknown>, where: Record<string, unknown>) {
  return Object.entries(where).every(([name, expected]) => {
    const actual = row[name];
    if (
      typeof expected === "object"
      && expected !== null
      && !Array.isArray(expected)
    ) {
      const predicate = expected as { not?: unknown };
      if (Object.hasOwn(predicate, "not")) {
        return predicate.not === null ? actual !== null : actual !== predicate.not;
      }
    }
    return actual === expected;
  });
}

function fixture() {
  const operation: MutableRow = {
    id: "operation-1",
    userId: "user-1",
    retentionHoldAt: null,
    retentionHoldId: null,
    paymentRecord: null,
  };
  const record: MutableRow = {
    id: "record-1",
    userId: "user-1",
    retentionHoldAt: null,
    retentionHoldId: null,
    operation,
  };
  operation.paymentRecord = record;
  const holds: MutableHold[] = [];

  const updateRow = (row: MutableRow) => vi.fn(async (args: UpdateArguments) => {
    if (!matches(row as unknown as Record<string, unknown>, args.where)) {
      return { count: 0 };
    }
    Object.assign(row, args.data);
    return { count: 1 };
  });
  const tx = {
    paymentOperation: {
      findUnique: vi.fn(async ({ where }: { where: { id: string } }) =>
        where.id === operation.id ? operation : null),
      updateMany: updateRow(operation),
    },
    paymentRecord: {
      findUnique: vi.fn(async ({ where }: { where: { id: string } }) =>
        where.id === record.id ? record : null),
      updateMany: updateRow(record),
    },
    paymentRetentionHold: {
      findUnique: vi.fn(async ({ where }: { where: { holdIdHash: string } }) =>
        holds.find((hold) => hold.holdIdHash === where.holdIdHash) ?? null),
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        const hold: MutableHold = {
          id: `hold-row-${holds.length + 1}`,
          ...data,
        };
        holds.push(hold);
        return hold;
      }),
      updateMany: vi.fn(async (args: UpdateArguments) => {
        const hold = holds.find((candidate) => matches(candidate, args.where));
        if (!hold) return { count: 0 };
        Object.assign(hold, args.data);
        return { count: 1 };
      }),
    },
  };
  const prisma = {
    $transaction: vi.fn(async (callback: (value: typeof tx) => unknown) =>
      callback(tx)),
  };
  return { holds, operation, prisma, record, tx };
}

function placement(
  holdId = HOLD_A,
  selector: { operationId?: string; paymentRecordId?: string } = {
    operationId: "operation-1",
  },
) {
  return {
    action: "hold",
    holdId,
    ...selector,
    owner: "security-on-call",
    reason: "external legal case",
    reviewAt: REVIEW_AT,
  };
}

describe("payment retention hold operator workflow", () => {
  it("requires an isolated, validated hold-operator database environment", () => {
    const databaseUrl =
      "postgresql://clean_pay_hold:db-hold-unit-9Vr4Kp7Xs2Lm8Nc5Qw3H@postgres:5432/clean_pay?schema=public";
    expect(assertPaymentRetentionHoldRuntimeEnvironment({
      CLEAN_PAY_RUNTIME_ROLE: "hold-operator",
      DATABASE_URL: databaseUrl,
    })).toBe(databaseUrl);
    expect(() => assertPaymentRetentionHoldRuntimeEnvironment({
      CLEAN_PAY_RUNTIME_ROLE: "application",
      DATABASE_URL: databaseUrl,
    })).toThrow("CLEAN_PAY_RUNTIME_ROLE=hold-operator is required");
    expect(() => assertPaymentRetentionHoldRuntimeEnvironment({
      CLEAN_PAY_RUNTIME_ROLE: "hold-operator",
      DATABASE_URL: databaseUrl,
      MIGRATION_DATABASE_URL: databaseUrl,
    })).toThrow(
      "MIGRATION_DATABASE_URL must not be present in a role-scoped runtime environment",
    );
  });

  it("places a hashed caller identity atomically and retries idempotently", async () => {
    const state = fixture();
    const now = new Date("2026-08-26T00:00:00.000Z");
    state.prisma.$transaction.mockRejectedValueOnce(
      Object.assign(new Error("serialization conflict"), { code: "P2034" }),
    );

    await expect(placePaymentRetentionHold(
      state.prisma,
      placement(),
      now,
    )).resolves.toEqual({
      status: "ACTIVE",
      retentionHoldAt: now,
      reviewAt: new Date(REVIEW_AT),
    });

    expect(state.holds).toHaveLength(1);
    const hold = state.holds[0]!;
    expect(hold).toMatchObject({
      status: "ACTIVE",
      selectorKind: "PAYMENT_OPERATION",
      selectorId: "operation-1",
      caseUserId: "user-1",
      caseOperationId: "operation-1",
      casePaymentRecordId: "record-1",
      owner: "security-on-call",
      reason: "external legal case",
    });
    expect(hold.holdIdHash).toMatch(/^[0-9a-f]{64}$/);
    expect(hold.holdIdHash).not.toBe(HOLD_A);
    expect(hold.selectorEvidenceHash).toMatch(/^[0-9a-f]{64}$/);
    expect(state.operation).toMatchObject({
      retentionHoldId: hold.id,
      retentionHoldAt: now,
    });
    expect(state.record).toMatchObject({
      retentionHoldId: hold.id,
      retentionHoldAt: now,
    });

    await expect(placePaymentRetentionHold(
      state.prisma,
      placement(),
      new Date("2026-09-03T00:01:00.000Z"),
    )).resolves.toMatchObject({ status: "ACTIVE", retentionHoldAt: now });
    expect(state.holds).toHaveLength(1);
    expect(state.tx.paymentRetentionHold.create).toHaveBeenCalledTimes(1);
    expect(state.prisma.$transaction).toHaveBeenCalledWith(
      expect.any(Function),
      expect.objectContaining({ isolationLevel: "Serializable" }),
    );
    expect(state.prisma.$transaction).toHaveBeenCalledTimes(3);

    await expect(placePaymentRetentionHold(state.prisma, {
      ...placement(),
      reason: "changed retry payload",
    }, now)).rejects.toThrow("different placement data");
  });

  it("binds release to selector and holdId and fails closed on overlap", async () => {
    const state = fixture();
    const now = new Date("2026-08-26T00:00:00.000Z");
    await placePaymentRetentionHold(state.prisma, placement(), now);

    await expect(placePaymentRetentionHold(
      state.prisma,
      placement(HOLD_B, { paymentRecordId: "record-1" }),
      now,
    )).rejects.toThrow("different active hold");
    await expect(releasePaymentRetentionHold(state.prisma, {
      operationId: "operation-1",
      holdId: HOLD_B,
      releasedBy: "privacy-owner",
      reason: "case closed",
    }, now)).rejects.toThrow("was not found");
    await expect(releasePaymentRetentionHold(state.prisma, {
      paymentRecordId: "record-1",
      holdId: HOLD_A,
      releasedBy: "privacy-owner",
      reason: "case closed",
    }, now)).rejects.toThrow("does not belong to the selected");

    await expect(releasePaymentRetentionHold(state.prisma, {
      operationId: "operation-1",
      holdId: HOLD_A,
      releasedBy: "privacy-owner",
      reason: "case closed",
    }, now)).resolves.toEqual({ status: "RELEASED", releasedAt: now });
    expect(state.operation.retentionHoldId).toBeNull();
    expect(state.record.retentionHoldId).toBeNull();
    expect(state.holds[0]).toMatchObject({
      status: "RELEASED",
      activeCaseKey: null,
      releasedBy: "privacy-owner",
      releaseReason: "case closed",
      releasedAt: now,
    });

    await expect(releasePaymentRetentionHold(state.prisma, {
      operationId: "operation-1",
      holdId: HOLD_A,
      releasedBy: "privacy-owner",
      reason: "case closed",
    }, new Date("2026-08-26T00:05:00.000Z"))).resolves.toEqual({
      status: "RELEASED",
      releasedAt: now,
    });

    await placePaymentRetentionHold(
      state.prisma,
      placement(HOLD_B, { paymentRecordId: "record-1" }),
      new Date("2026-08-26T00:06:00.000Z"),
    );
    await expect(releasePaymentRetentionHold(state.prisma, {
      operationId: "operation-1",
      holdId: HOLD_A,
      releasedBy: "privacy-owner",
      reason: "case closed",
    }, now)).resolves.toEqual({ status: "RELEASED", releasedAt: now });
    expect(state.operation.retentionHoldId).toBe(state.holds[1]!.id);
    expect(state.record.retentionHoldId).toBe(state.holds[1]!.id);
  });

  it("requires release before disposition, blocks another active hold, and scrubs case metadata", async () => {
    const state = fixture();
    const placedAt = new Date("2026-08-26T00:00:00.000Z");
    const releasedAt = new Date("2026-08-26T01:00:00.000Z");
    const disposedAt = new Date("2026-08-26T02:00:00.000Z");
    await placePaymentRetentionHold(state.prisma, placement(), placedAt);

    await expect(disposePaymentRetentionHold(state.prisma, {
      operationId: "operation-1",
      holdId: HOLD_A,
      disposedBy: "records-owner",
      disposition: "CASE_CLOSED",
    }, disposedAt)).rejects.toThrow("Release");
    await releasePaymentRetentionHold(state.prisma, {
      operationId: "operation-1",
      holdId: HOLD_A,
      releasedBy: "privacy-owner",
      reason: "case closed",
    }, releasedAt);

    await placePaymentRetentionHold(
      state.prisma,
      placement(HOLD_B, { paymentRecordId: "record-1" }),
      new Date("2026-08-26T01:30:00.000Z"),
    );
    await expect(disposePaymentRetentionHold(state.prisma, {
      operationId: "operation-1",
      holdId: HOLD_A,
      disposedBy: "records-owner",
      disposition: "CASE_CLOSED",
    }, disposedAt)).rejects.toThrow("another active hold");
    await releasePaymentRetentionHold(state.prisma, {
      paymentRecordId: "record-1",
      holdId: HOLD_B,
      releasedBy: "privacy-owner",
      reason: "follow-up closed",
    }, disposedAt);

    await expect(disposePaymentRetentionHold(state.prisma, {
      operationId: "operation-1",
      holdId: HOLD_A,
      disposedBy: "records-owner",
      disposition: "CASE_CLOSED",
    }, disposedAt)).resolves.toEqual({ status: "DISPOSED", disposedAt });
    expect(state.holds[0]).toMatchObject({
      status: "DISPOSED",
      selectorKind: null,
      selectorId: null,
      activeCaseKey: null,
      caseUserId: null,
      caseOperationId: null,
      casePaymentRecordId: null,
      owner: null,
      reason: null,
      reviewAt: null,
      releasedBy: null,
      releaseReason: null,
      releasedAt,
      disposedBy: "records-owner",
      disposition: "CASE_CLOSED",
      disposedAt,
    });
    expect(state.holds[0]!.holdIdHash).toMatch(/^[0-9a-f]{64}$/);
    expect(state.holds[0]!.selectorEvidenceHash).toMatch(/^[0-9a-f]{64}$/);

    await expect(disposePaymentRetentionHold(state.prisma, {
      paymentRecordId: "record-1",
      holdId: HOLD_A,
      disposedBy: "records-owner",
      disposition: "CASE_CLOSED",
    }, new Date("2026-08-26T03:00:00.000Z"))).rejects.toThrow(
      "does not belong to the selected",
    );
    const operationResolutionCount = state.tx.paymentOperation.findUnique.mock.calls.length;
    await expect(disposePaymentRetentionHold(state.prisma, {
      operationId: "operation-1",
      holdId: HOLD_A,
      disposedBy: "records-owner",
      disposition: "CASE_CLOSED",
    }, new Date("2026-08-26T03:00:00.000Z"))).resolves.toEqual({
      status: "DISPOSED",
      disposedAt,
    });
    expect(state.tx.paymentOperation.findUnique).toHaveBeenCalledTimes(
      operationResolutionCount,
    );
  });

  it("rejects ambiguous or non-opaque input and fail-closes unidentified legacy timestamps", async () => {
    const state = fixture();
    const now = new Date("2026-08-26T00:00:00.000Z");
    await expect(placePaymentRetentionHold(state.prisma, {
      ...placement(),
      paymentRecordId: "record-1",
    }, now)).rejects.toThrow("exactly one");
    await expect(placePaymentRetentionHold(state.prisma, {
      ...placement("case-123"),
    }, now)).rejects.toThrow("opaque UUIDv4");
    await expect(placePaymentRetentionHold(state.prisma, {
      ...placement(),
      reviewAt: "2026-08-25T00:00:00.000Z",
    }, now)).rejects.toThrow("future");

    state.operation.retentionHoldAt = now;
    await expect(placePaymentRetentionHold(
      state.prisma,
      placement(),
      now,
    )).rejects.toThrow("timestamp-only hold");

    const stream = new PassThrough();
    stream.end(JSON.stringify({ payload: "x".repeat(17 * 1_024) }));
    await expect(readBoundedJson(stream)).rejects.toThrow("16 KiB");
  });

  it("replays a completed release but fail-closes disposition on unidentified state", async () => {
    const state = fixture();
    const heldAt = new Date("2026-08-26T00:00:00.000Z");
    await placePaymentRetentionHold(state.prisma, placement(), heldAt);
    await releasePaymentRetentionHold(state.prisma, {
      operationId: "operation-1",
      holdId: HOLD_A,
      releasedBy: "privacy-owner",
      reason: "case closed",
    }, new Date("2026-08-26T01:00:00.000Z"));
    state.operation.retentionHoldAt = new Date("2026-08-26T01:30:00.000Z");

    await expect(releasePaymentRetentionHold(state.prisma, {
      operationId: "operation-1",
      holdId: HOLD_A,
      releasedBy: "privacy-owner",
      reason: "case closed",
    }, new Date("2026-08-26T02:00:00.000Z"))).resolves.toEqual({
      status: "RELEASED",
      releasedAt: new Date("2026-08-26T01:00:00.000Z"),
    });
    await expect(disposePaymentRetentionHold(state.prisma, {
      operationId: "operation-1",
      holdId: HOLD_A,
      disposedBy: "records-owner",
      disposition: "CASE_CLOSED",
    }, new Date("2026-08-26T02:00:00.000Z"))).rejects.toThrow("unidentified hold");
  });

  it("ships database-enforced lifecycle and active-pointer constraints", () => {
    const command = readFileSync(
      "deploy/prod/payment-retention-hold-command.mjs",
      "utf8",
    );
    expect(command).toContain("role: \"holdOperator\"");
    expect(command).toContain("prismaPgAdapterOptions(connectionString)");
    expect(command).not.toMatch(/\blog\s*:\s*\[\s*["']error["']/);
    const migration = readFileSync(
      "prisma/migrations/20260825220000_add_payment_retention_hold_lifecycle/migration.sql",
      "utf8",
    );
    const executableLines = migration
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line.length > 0 && !line.startsWith("--"));
    expect(executableLines[0]).toBe("BEGIN;");
    expect(executableLines.at(-1)).toBe("COMMIT;");
    expect(executableLines.filter((line) => line === "BEGIN;")).toHaveLength(1);
    expect(executableLines.filter((line) => line === "COMMIT;")).toHaveLength(1);
    expect(migration).toContain('CREATE TABLE "PaymentRetentionHold"');
    expect(migration).toContain('CONSTRAINT "PaymentRetentionHold_lifecycle_check"');
    expect(migration).toContain('CONSTRAINT "PaymentRetentionHold_selector_case_check"');
    expect(migration).toContain('"PaymentOperation_retention_hold_pointer_pair_check"');
    expect(migration).toContain('"PaymentRecord_retention_hold_pointer_pair_check"');
    expect(migration).toContain('"PaymentRetentionHold_active_caseOperationId_key"');
    expect(migration).toContain('"PaymentRetentionHold_active_casePaymentRecordId_key"');
    expect(migration).toContain('"selectorId" = "caseOperationId"');
    expect(migration).toContain('"selectorId" = "casePaymentRecordId"');
    expect(migration).toContain('"PaymentOperation_retentionHoldId_fkey"');
    expect(migration).toContain('"PaymentRecord_retentionHoldId_fkey"');
    expect(migration).toContain('"PaymentRetentionHold_caseOperationId_fkey"');
    expect(migration).toContain('"PaymentRetentionHold_casePaymentRecordId_fkey"');
    expect(migration).toContain('"PaymentRecord_prevent_held_case_link"');
    expect(migration).toContain('"PaymentRetentionHold_prevent_retained_delete"');
    expect(migration).toContain('CREATE FUNCTION "prevent_payment_retention_hold_reassignment"()');
    expect(migration).toContain('CREATE FUNCTION "enforce_payment_retention_hold_integrity"()');
    expect(migration).toContain('CREATE TRIGGER "PaymentRetentionHold_prevent_reassignment"');
    expect(migration).toContain('CREATE CONSTRAINT TRIGGER "PaymentOperation_payment_retention_hold_integrity"');
    expect(migration).toContain('CREATE CONSTRAINT TRIGGER "PaymentRecord_payment_retention_hold_integrity"');
    expect(migration).toContain('CREATE CONSTRAINT TRIGGER "PaymentRetentionHold_payment_retention_hold_integrity"');
    expect(migration.match(/ON DELETE RESTRICT ON UPDATE RESTRICT;/g)).toHaveLength(4);
    expect(migration).toContain("payment retention hold must be disposed before deletion");
    expect(migration).toContain("SET search_path = pg_catalog");
    expect(migration).toContain("TG_TABLE_SCHEMA");
    expect(migration).toContain('%I."PaymentOperation"');
    expect(migration).toContain('%I."PaymentRetentionHold"');
    expect(migration).toContain('USING OLD."operationId"');
    expect(migration).toContain("old_operation_case_retained");
    expect(migration).toContain("record_case_retained");
    expect(migration).toContain(
      "cannot unlink a payment record while either case row is retained",
    );
    const unchangedLinkGuard = migration.indexOf(
      'NEW."operationId" IS NOT DISTINCT FROM OLD."operationId"',
    );
    const oldOperationLookup = migration.indexOf(
      'USING OLD."operationId"',
      unchangedLinkGuard,
    );
    const unlinkBranch = migration.indexOf(
      'IF NEW."operationId" IS NULL THEN',
      oldOperationLookup,
    );
    expect(unchangedLinkGuard).toBeGreaterThan(-1);
    expect(oldOperationLookup).toBeGreaterThan(unchangedLinkGuard);
    expect(unlinkBranch).toBeGreaterThan(oldOperationLookup);
    expect(migration).not.toContain('FROM "PaymentOperation"\n');
    expect(migration).not.toContain('FROM "PaymentRetentionHold"\n');
    expect(migration).toContain('"selectorEvidenceHash" CHAR(64) NOT NULL');
    expect(migration).toContain('"PaymentRetentionHold_activeCaseKey_key"');
    expect(migration).toContain(
      '"PaymentOperation_retention_hold_pointer_pair_check"',
    );
    expect(migration).toContain(
      '"PaymentRecord_retention_hold_pointer_pair_check"',
    );
    expect(migration).toContain(
      '"PaymentRetentionHold_active_caseOperationId_key"',
    );
    expect(migration).toContain(
      '"PaymentRetentionHold_active_casePaymentRecordId_key"',
    );
    expect(migration).toContain(
      'CREATE FUNCTION "enforce_payment_retention_hold_integrity"',
    );
    expect(migration).toContain(
      'CREATE FUNCTION "prevent_payment_retention_hold_reassignment"',
    );
    expect(migration).toContain(
      '"PaymentRetentionHold_prevent_reassignment"',
    );
    expect(migration).toContain("SECURITY DEFINER");
    expect(migration).toContain("DEFERRABLE INITIALLY DEFERRED");
    expect(migration).toContain(
      'hold."casePaymentRecordId" IS DISTINCT FROM linked_record."id"',
    );
    expect(migration).toContain(
      'hold."caseOperationId" IS DISTINCT FROM record."operationId"',
    );
    expect(migration).toContain(
      'hold."caseUserId" IS DISTINCT FROM operation."userId"',
    );
    expect(migration).toContain(
      'operation."retentionHoldAt" IS DISTINCT FROM hold."heldAt"',
    );
    expect(migration).toContain("payment retention hold integrity violation");
    expect(migration).toContain(
      "payment retention hold lifecycle cannot move backwards or skip release",
    );
    expect(migration.match(/ON DELETE RESTRICT ON UPDATE RESTRICT/g)).toHaveLength(4);
    expect(migration).toContain("timestamp-only payment retention holds must be reviewed");
    expect(migration).not.toMatch(/ON DELETE CASCADE/i);
  });
});
