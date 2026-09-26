import { createHash, createHmac } from "node:crypto";

const MAX_CASE_IDENTIFIER_LENGTH = 191;
const MAX_OWNER_LENGTH = 120;
const MAX_REASON_LENGTH = 1_000;
const UUID_V4_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export const PAYMENT_RETENTION_DISPOSITIONS = Object.freeze([
  "CASE_CLOSED",
  "LEGAL_RETENTION_SATISFIED",
  "EVIDENCE_TRANSFERRED",
]);

const dispositionValues = new Set(PAYMENT_RETENTION_DISPOSITIONS);
const transactionOptions = Object.freeze({
  isolationLevel: "Serializable",
  maxWait: 5_000,
  timeout: 15_000,
});

function retryableTransactionConflict(error) {
  return typeof error === "object"
    && error !== null
    && ["P2002", "P2034"].includes(error.code);
}

async function serializableTransaction(prisma, work) {
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      return await prisma.$transaction(work, transactionOptions);
    } catch (error) {
      if (attempt === 3 || !retryableTransactionConflict(error)) throw error;
    }
  }
  throw new Error("Payment retention hold transaction retry exhausted");
}

function requiredText(value, name, maximum) {
  if (typeof value !== "string") throw new Error(`${name} is required`);
  const normalized = value.trim();
  if (!normalized || normalized.length > maximum) {
    throw new Error(`${name} must contain 1-${maximum} characters`);
  }
  return normalized;
}

function holdIdentifier(value) {
  const normalized = requiredText(value, "holdId", 36).toLowerCase();
  if (!UUID_V4_PATTERN.test(normalized)) {
    throw new Error("holdId must be a caller-generated opaque UUIDv4");
  }
  return normalized;
}

function selector(input) {
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    throw new Error("Retention hold request must be an object");
  }
  const operationId = typeof input.operationId === "string"
    ? input.operationId.trim()
    : "";
  const paymentRecordId = typeof input.paymentRecordId === "string"
    ? input.paymentRecordId.trim()
    : "";
  if (Boolean(operationId) === Boolean(paymentRecordId)) {
    throw new Error("Provide exactly one of operationId or paymentRecordId");
  }
  const id = operationId || paymentRecordId;
  if (id.length > MAX_CASE_IDENTIFIER_LENGTH) {
    throw new Error(
      `Payment case identifier must contain 1-${MAX_CASE_IDENTIFIER_LENGTH} characters`,
    );
  }
  return operationId
    ? { kind: "PAYMENT_OPERATION", id: operationId }
    : { kind: "PAYMENT_RECORD", id: paymentRecordId };
}

function reviewDate(value) {
  const reviewAt = new Date(value);
  if (!Number.isFinite(reviewAt.getTime())) {
    throw new Error("reviewAt must be a valid timestamp");
  }
  return reviewAt;
}

function assertFutureReviewDate(reviewAt, now) {
  if (reviewAt <= now) {
    throw new Error("reviewAt must be a future timestamp for a new hold");
  }
}

function validLifecycleTime(value, name) {
  if (!(value instanceof Date) || !Number.isFinite(value.getTime())) {
    throw new Error(`${name} must be a valid timestamp`);
  }
  return value;
}

function digest(namespace, value) {
  return createHash("sha256")
    .update(`clean-pay/${namespace}/v1\0`, "utf8")
    .update(value, "utf8")
    .digest("hex");
}

function holdIdDigest(holdId) {
  return digest("payment-retention-hold", holdId);
}

function selectorDigest(selected, holdId) {
  return createHmac("sha256", holdId)
    .update("clean-pay/payment-retention-selector/v2\0", "utf8")
    .update(selected.kind, "utf8")
    .update("\0", "utf8")
    .update(selected.id, "utf8")
    .digest("hex");
}

function activeCaseDigest(paymentCase) {
  const identity = paymentCase.operation
    ? `PAYMENT_OPERATION\0${paymentCase.operation.id}`
    : `PAYMENT_RECORD\0${paymentCase.paymentRecord.id}`;
  return digest("payment-retention-active-case", identity);
}

function operationRow(value) {
  if (!value) return null;
  return {
    model: "paymentOperation",
    id: value.id,
    retentionHoldAt: value.retentionHoldAt,
    retentionHoldId: value.retentionHoldId,
  };
}

function paymentRecordRow(value) {
  if (!value) return null;
  return {
    model: "paymentRecord",
    id: value.id,
    retentionHoldAt: value.retentionHoldAt,
    retentionHoldId: value.retentionHoldId,
  };
}

function caseRows(paymentCase) {
  return [
    operationRow(paymentCase.operation),
    paymentRecordRow(paymentCase.paymentRecord),
  ].filter(Boolean);
}

async function resolvePaymentCase(tx, selected) {
  if (selected.kind === "PAYMENT_OPERATION") {
    const operation = await tx.paymentOperation.findUnique({
      where: { id: selected.id },
      select: {
        id: true,
        userId: true,
        retentionHoldAt: true,
        retentionHoldId: true,
        paymentRecord: {
          select: {
            id: true,
            retentionHoldAt: true,
            retentionHoldId: true,
          },
        },
      },
    });
    if (!operation) throw new Error("Payment operation was not found");
    return {
      userId: operation.userId,
      operation,
      paymentRecord: operation.paymentRecord,
    };
  }

  const paymentRecord = await tx.paymentRecord.findUnique({
    where: { id: selected.id },
    select: {
      id: true,
      userId: true,
      retentionHoldAt: true,
      retentionHoldId: true,
      operation: {
        select: {
          id: true,
          retentionHoldAt: true,
          retentionHoldId: true,
        },
      },
    },
  });
  if (!paymentRecord) throw new Error("Payment record was not found");
  return {
    userId: paymentRecord.userId,
    operation: paymentRecord.operation,
    paymentRecord,
  };
}

function assertNoUnidentifiedHold(paymentCase) {
  const unidentified = caseRows(paymentCase).some((row) =>
    row.retentionHoldAt && !row.retentionHoldId);
  if (unidentified) {
    throw new Error(
      "Payment case has a timestamp-only hold without durable identity; review it manually",
    );
  }
}

function assertNoOtherHold(paymentCase, allowedHoldId = null) {
  const conflicting = caseRows(paymentCase).find((row) =>
    row.retentionHoldId && row.retentionHoldId !== allowedHoldId);
  if (conflicting) {
    throw new Error("Payment case is protected by a different active hold");
  }
}

function assertPlacementMatches(existing, input) {
  if (
    existing.selectorKind !== input.selected.kind
    || existing.selectorId !== input.selected.id
    || existing.selectorEvidenceHash !== input.selectorEvidenceHash
    || existing.owner !== input.owner
    || existing.reason !== input.reason
    || existing.reviewAt?.getTime() !== input.reviewAt.getTime()
  ) {
    throw new Error("holdId already exists with different placement data");
  }
}

function assertStoredCaseMatches(existing, paymentCase) {
  if (existing.caseUserId !== paymentCase.userId) {
    throw new Error("Payment hold case owner changed unexpectedly");
  }
  if (existing.caseOperationId !== (paymentCase.operation?.id ?? null)) {
    throw new Error("Payment hold operation linkage changed unexpectedly");
  }
  if (existing.casePaymentRecordId !== (paymentCase.paymentRecord?.id ?? null)) {
    throw new Error("Payment hold record linkage changed unexpectedly");
  }
}

function assertCaseRowsClaimed(paymentCase, holdId) {
  const inconsistent = caseRows(paymentCase).some((row) =>
    row.retentionHoldId !== holdId || !row.retentionHoldAt);
  if (inconsistent) {
    throw new Error("Payment case active hold pointers are inconsistent; review it manually");
  }
}

async function claimCaseRows(tx, paymentCase, hold, heldAt) {
  assertNoUnidentifiedHold(paymentCase);
  assertNoOtherHold(paymentCase, hold.id);

  for (const row of caseRows(paymentCase)) {
    if (row.retentionHoldId === hold.id) {
      if (!row.retentionHoldAt) {
        throw new Error("Active hold pointer is missing its retention timestamp");
      }
      continue;
    }
    const result = await tx[row.model].updateMany({
      where: {
        id: row.id,
        retentionHoldId: null,
        retentionHoldAt: null,
      },
      data: {
        retentionHoldId: hold.id,
        retentionHoldAt: heldAt,
      },
    });
    if (result.count !== 1) {
      throw new Error("Payment case acquired another hold concurrently");
    }
  }
}

function placementResult(existing) {
  return {
    status: existing.status,
    retentionHoldAt: existing.heldAt,
    reviewAt: existing.reviewAt,
  };
}

export async function placePaymentRetentionHold(prisma, input, now = new Date()) {
  validLifecycleTime(now, "heldAt");
  const selected = selector(input);
  const holdId = holdIdentifier(input.holdId);
  const owner = requiredText(input.owner, "owner", MAX_OWNER_LENGTH);
  const reason = requiredText(input.reason, "reason", MAX_REASON_LENGTH);
  const reviewAt = reviewDate(input.reviewAt);
  const holdIdHash = holdIdDigest(holdId);
  const selectorEvidenceHash = selectorDigest(selected, holdId);

  return serializableTransaction(prisma, async (tx) => {
    const paymentCase = await resolvePaymentCase(tx, selected);
    const existing = await tx.paymentRetentionHold.findUnique({
      where: { holdIdHash },
    });
    if (existing) {
      assertPlacementMatches(existing, {
        selected,
        selectorEvidenceHash,
        owner,
        reason,
        reviewAt,
      });
      if (existing.status !== "ACTIVE") {
        throw new Error("holdId belongs to a hold that has already completed");
      }
      assertStoredCaseMatches(existing, paymentCase);
      assertNoUnidentifiedHold(paymentCase);
      assertNoOtherHold(paymentCase, existing.id);
      assertCaseRowsClaimed(paymentCase, existing.id);
      return placementResult(existing);
    }

    assertFutureReviewDate(reviewAt, now);
    assertNoUnidentifiedHold(paymentCase);
    assertNoOtherHold(paymentCase);
    const hold = await tx.paymentRetentionHold.create({
      data: {
        holdIdHash,
        status: "ACTIVE",
        selectorKind: selected.kind,
        selectorId: selected.id,
        selectorEvidenceHash,
        activeCaseKey: activeCaseDigest(paymentCase),
        caseUserId: paymentCase.userId,
        caseOperationId: paymentCase.operation?.id ?? null,
        casePaymentRecordId: paymentCase.paymentRecord?.id ?? null,
        owner,
        reason,
        reviewAt,
        heldAt: now,
      },
    });
    await claimCaseRows(tx, paymentCase, hold, now);
    return placementResult(hold);
  });
}

function assertSelectorMatches(existing, selected, evidenceHash) {
  if (existing.selectorEvidenceHash !== evidenceHash) {
    throw new Error("holdId does not belong to the selected payment case");
  }
  if (
    existing.status !== "DISPOSED"
    && (existing.selectorKind !== selected.kind || existing.selectorId !== selected.id)
  ) {
    throw new Error("holdId does not belong to the selected payment case");
  }
}

function assertNoActivePointer(paymentCase) {
  if (caseRows(paymentCase).some((row) =>
    row.retentionHoldId || row.retentionHoldAt)) {
    throw new Error(
      "Payment case has another active hold or an unidentified hold; disposition is blocked",
    );
  }
}

async function releaseCaseRows(tx, paymentCase, existing) {
  assertNoUnidentifiedHold(paymentCase);
  assertNoOtherHold(paymentCase, existing.id);
  assertStoredCaseMatches(existing, paymentCase);

  const rows = caseRows(paymentCase);
  assertCaseRowsClaimed(paymentCase, existing.id);

  for (const row of rows) {
    const result = await tx[row.model].updateMany({
      where: {
        id: row.id,
        retentionHoldId: existing.id,
        retentionHoldAt: { not: null },
      },
      data: {
        retentionHoldId: null,
        retentionHoldAt: null,
      },
    });
    if (result.count !== 1) {
      throw new Error("Active hold pointer changed concurrently");
    }
  }
}

export async function releasePaymentRetentionHold(prisma, input, now = new Date()) {
  validLifecycleTime(now, "releasedAt");
  const selected = selector(input);
  const holdId = holdIdentifier(input.holdId);
  const holdIdHash = holdIdDigest(holdId);
  const evidenceHash = selectorDigest(selected, holdId);
  const releasedBy = requiredText(
    input.releasedBy,
    "releasedBy",
    MAX_OWNER_LENGTH,
  );
  const reason = requiredText(input.reason, "reason", MAX_REASON_LENGTH);

  return serializableTransaction(prisma, async (tx) => {
    const paymentCase = await resolvePaymentCase(tx, selected);
    const existing = await tx.paymentRetentionHold.findUnique({
      where: { holdIdHash },
    });
    if (!existing) throw new Error("Payment retention hold was not found");
    assertSelectorMatches(existing, selected, evidenceHash);

    if (existing.status === "DISPOSED") {
      throw new Error("Payment retention hold has already been disposed");
    }
    if (existing.status === "RELEASED") {
      if (existing.releasedBy !== releasedBy || existing.releaseReason !== reason) {
        throw new Error("holdId was already released with different release data");
      }
      // This is a read-only replay of a completed transition. A later hold on
      // the same case must not erase the response to an exact release retry.
      return { status: existing.status, releasedAt: existing.releasedAt };
    }

    if (now < existing.heldAt) {
      throw new Error("releasedAt cannot precede heldAt");
    }

    await releaseCaseRows(tx, paymentCase, existing);
    const updated = await tx.paymentRetentionHold.updateMany({
      where: {
        id: existing.id,
        status: "ACTIVE",
        activeCaseKey: existing.activeCaseKey,
      },
      data: {
        status: "RELEASED",
        activeCaseKey: null,
        releasedBy,
        releaseReason: reason,
        releasedAt: now,
      },
    });
    if (updated.count !== 1) {
      throw new Error("Payment retention hold changed concurrently");
    }
    return { status: "RELEASED", releasedAt: now };
  });
}

export async function disposePaymentRetentionHold(prisma, input, now = new Date()) {
  validLifecycleTime(now, "disposedAt");
  const selected = selector(input);
  const holdId = holdIdentifier(input.holdId);
  const holdIdHash = holdIdDigest(holdId);
  const evidenceHash = selectorDigest(selected, holdId);
  const disposedBy = requiredText(
    input.disposedBy,
    "disposedBy",
    MAX_OWNER_LENGTH,
  );
  const disposition = requiredText(input.disposition, "disposition", 64);
  if (!dispositionValues.has(disposition)) {
    throw new Error(
      `disposition must be one of ${PAYMENT_RETENTION_DISPOSITIONS.join(", ")}`,
    );
  }

  return serializableTransaction(prisma, async (tx) => {
    const existing = await tx.paymentRetentionHold.findUnique({
      where: { holdIdHash },
    });
    if (!existing) throw new Error("Payment retention hold was not found");
    assertSelectorMatches(existing, selected, evidenceHash);

    // The selector is retained only as HMAC evidence keyed by the opaque UUID.
    // This permits an exact retry after the payment row has been lawfully
    // removed without leaving a database-only enumeration oracle.
    if (existing.status === "DISPOSED") {
      if (
        existing.disposedBy !== disposedBy
        || existing.disposition !== disposition
      ) {
        throw new Error("holdId was already disposed with different disposition data");
      }
      return { status: existing.status, disposedAt: existing.disposedAt };
    }

    const paymentCase = await resolvePaymentCase(tx, selected);

    if (existing.status === "ACTIVE") {
      throw new Error("Release the payment retention hold before disposition");
    }
    assertNoActivePointer(paymentCase);

    if (now < existing.releasedAt) {
      throw new Error("disposedAt cannot precede releasedAt");
    }

    assertStoredCaseMatches(existing, paymentCase);
    const updated = await tx.paymentRetentionHold.updateMany({
      where: {
        id: existing.id,
        status: "RELEASED",
        selectorEvidenceHash: evidenceHash,
      },
      data: {
        status: "DISPOSED",
        selectorKind: null,
        selectorId: null,
        caseUserId: null,
        caseOperationId: null,
        casePaymentRecordId: null,
        owner: null,
        reason: null,
        reviewAt: null,
        releasedBy: null,
        releaseReason: null,
        disposedBy,
        disposition,
        disposedAt: now,
      },
    });
    if (updated.count !== 1) {
      throw new Error("Payment retention hold changed concurrently");
    }
    return { status: "DISPOSED", disposedAt: now };
  });
}
