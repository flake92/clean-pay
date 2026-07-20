import { Prisma } from "@prisma/client";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  const paymentOperation = {
    create: vi.fn(),
    findUnique: vi.fn(),
    updateMany: vi.fn(),
  };
  const paymentRecord = {
    findUnique: vi.fn(),
    create: vi.fn(),
    updateMany: vi.fn(),
  };
  const queryRaw = vi.fn();
  const transaction = { paymentOperation, paymentRecord, $queryRaw: queryRaw };
  const prisma = {
    paymentOperation,
    paymentRecord,
    $transaction: vi.fn(),
  };

  const lockPaymentUpstreamOwner = vi.fn();

  return {
    paymentOperation,
    paymentRecord,
    transaction,
    prisma,
    queryRaw,
    lockPaymentUpstreamOwner,
  };
});

vi.mock("@/backend/database/prisma", () => ({
  prisma: mocks.prisma,
}));
vi.mock("@/backend/payments/owner", () => ({
  lockPaymentUpstreamOwner: mocks.lockPaymentUpstreamOwner,
}));

import { BffError } from "@/backend/integrations/remnashop/errors";
import {
  beginPaymentOperation,
  bindPaymentOperationUpstreamOwner,
  completePaymentOperationSuccess,
  markPaymentOperationDispatched,
  paymentOperationDispatchFailureOutcome,
  paymentOperationErrorFromSnapshot,
  settlePaymentOperationAfterDispatchFailure,
  settlePaymentOperationBeforeDispatchFailure,
} from "@/backend/payments/idempotency";
import { sha256 } from "@/backend/security/crypto";

const CLIENT_KEY = "4f4cf1a3-797f-4b69-b39f-09c4da39f96a";

function storedOperation(
  data: Record<string, unknown>,
  overrides: Record<string, unknown> = {},
) {
  return {
    id: "operation-1",
    status: "READY",
    attemptCount: 0,
    upstreamOwnerHash: null,
    claimTokenHash: null,
    leaseExpiresAt: null,
    dispatchedAt: null,
    outcomeUnknownAt: null,
    completedAt: null,
    reconciledAt: null,
    reconcileErrorSnapshot: null,
    responseStatus: null,
    responseSnapshot: null,
    errorSnapshot: null,
    createdAt: new Date("2026-07-17T00:00:00.000Z"),
    updatedAt: new Date("2026-07-17T00:00:00.000Z"),
    ...data,
    ...overrides,
  };
}

function purchaseOperation(durationDays = 30) {
  return {
    kind: "PURCHASE" as const,
    payload: {
      plan_code: "basic",
      duration_days: durationDays,
      gateway_type: "YOOKASSA",
      confirmed_amount: "100.00",
      confirmed_currency: "RUB",
      offer_version: "v1:test-offer",
    },
  };
}

function beginInput(overrides: Record<string, unknown> = {}) {
  return {
    userId: "user-1",
    idempotencyKey: CLIENT_KEY,
    operation: purchaseOperation(),
    ...overrides,
  };
}

function uniqueConstraintError() {
  return new Prisma.PrismaClientKnownRequestError("Unique constraint", {
    code: "P2002",
    clientVersion: "7.8.0",
  });
}

function paymentInput() {
  return {
    userId: "user-1",
    gatewayType: "YOOKASSA",
    durationDays: 30,
    payment: {
      payment_id: "payment-1",
      payment_url: "https://pay.test/payment-1",
      purchase_type: "subscription",
      status: "pending",
      is_free: false,
      final_amount: "100.00",
      currency: "RUB",
    },
  };
}

describe("payment operation idempotency", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.paymentOperation.create.mockImplementation(
      async ({ data }: { data: Record<string, unknown> }) =>
        storedOperation(data),
    );
    mocks.paymentOperation.findUnique.mockResolvedValue(null);
    mocks.paymentOperation.updateMany.mockResolvedValue({ count: 1 });
    mocks.paymentRecord.findUnique.mockResolvedValue(null);
    mocks.paymentRecord.create.mockResolvedValue({ id: "record-1" });
    mocks.paymentRecord.updateMany.mockResolvedValue({ count: 1 });
    mocks.queryRaw.mockResolvedValue([{ id: "user-1" }]);
    mocks.lockPaymentUpstreamOwner.mockResolvedValue(undefined);
    mocks.prisma.$transaction.mockImplementation(
      async (callback: (transaction: typeof mocks.transaction) => unknown) =>
        callback(mocks.transaction),
    );
  });

  it("requires a UUID key and accepts zero-day/free operations", async () => {
    await expect(
      beginPaymentOperation(beginInput({ idempotencyKey: null }) as never),
    ).rejects.toMatchObject({
      code: "IDEMPOTENCY_KEY_REQUIRED",
      status: 400,
    });
    await expect(
      beginPaymentOperation(beginInput({ idempotencyKey: "not-a-uuid" }) as never),
    ).rejects.toMatchObject({
      code: "IDEMPOTENCY_KEY_INVALID",
      status: 400,
    });

    await expect(
      beginPaymentOperation(
        beginInput({ operation: purchaseOperation(0) }) as never,
      ),
    ).resolves.toMatchObject({ state: "execute" });
  });

  it("can inspect a new key without creating or claiming an operation", async () => {
    await expect(
      beginPaymentOperation(
        beginInput({ createIfMissing: false }) as never,
      ),
    ).resolves.toEqual({ state: "missing" });

    expect(mocks.paymentOperation.create).not.toHaveBeenCalled();
    expect(mocks.paymentOperation.updateMany).not.toHaveBeenCalled();
  });

  it("locks and revalidates the local owner before inserting a new operation", async () => {
    mocks.queryRaw.mockResolvedValueOnce([]);

    await expect(beginPaymentOperation(beginInput() as never)).rejects.toMatchObject({
      code: "ACCOUNT_MERGE_REQUIRED",
      status: 409,
    });

    expect(mocks.paymentOperation.create).not.toHaveBeenCalled();
    const lockSql = mocks.queryRaw.mock.calls[0]?.[0] as {
      strings?: string[];
      values?: unknown[];
    };
    expect(lockSql.strings?.join(" ")).toContain('FROM "WebUser"');
    expect(lockSql.strings?.join(" ")).toContain("FOR KEY SHARE");
    expect(lockSql.values).toContain("user-1");
    expect(mocks.prisma.$transaction).toHaveBeenCalledWith(
      expect.any(Function),
      { maxWait: 5_000, timeout: 30_000 },
    );
  });

  it("stores only hashed identities and a canonical known-field request", async () => {
    let createdData: Record<string, unknown> | undefined;
    mocks.paymentOperation.create.mockImplementation(
      async ({ data }: { data: Record<string, unknown> }) => {
        createdData = data;
        return storedOperation(data);
      },
    );

    const result = await beginPaymentOperation(
      beginInput({
        idempotencyKey: CLIENT_KEY.toUpperCase(),
        operation: {
          ...purchaseOperation(),
          payload: {
            ...purchaseOperation().payload,
            ignored_client_field: "do-not-fingerprint",
          },
        },
      }) as never,
    );

    expect(result).toMatchObject({
      state: "execute",
      operationId: "operation-1",
      upstreamKey: expect.stringMatching(/^[0-9a-f-]{36}$/),
    });
    expect(createdData?.requestPayload).toEqual({
      plan_code: "basic",
      duration_days: 30,
      gateway_type: "YOOKASSA",
      confirmed_amount: "100.00",
      confirmed_currency: "RUB",
      offer_version: "v1:test-offer",
    });
    expect(createdData?.idempotencyKeyHash).not.toBe(CLIENT_KEY);
    expect(createdData?.upstreamOwnerHash).toBeUndefined();
    expect(JSON.stringify(createdData)).not.toContain(CLIENT_KEY);
    expect(JSON.stringify(createdData)).not.toContain("remnashop-user-1");
    expect(mocks.paymentOperation.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          attemptCount: { increment: 1 },
        }),
      }),
    );
  });

  it("documents that a lost client key permits a second operation for the same payload", async () => {
    const secondKey = "dc5083b1-b866-4a5b-b45b-a73f47ce4b10";

    await beginPaymentOperation(beginInput({ idempotencyKey: CLIENT_KEY }) as never);
    await beginPaymentOperation(beginInput({ idempotencyKey: secondKey }) as never);

    expect(mocks.paymentOperation.create).toHaveBeenCalledTimes(2);
    const [first, second] = mocks.paymentOperation.create.mock.calls.map(
      (call) => call[0].data as Record<string, unknown>,
    );
    expect(first.requestFingerprint).toBe(second.requestFingerprint);
    expect(first.idempotencyKeyHash).not.toBe(second.idempotencyKeyHash);
  });

  it("rejects reuse for another payload", async () => {
    let operation: ReturnType<typeof storedOperation> | undefined;
    mocks.paymentOperation.create.mockImplementation(
      async ({ data }: { data: Record<string, unknown> }) => {
        operation = storedOperation(data);
        return operation;
      },
    );

    await beginPaymentOperation(beginInput() as never);
    mocks.paymentOperation.create.mockRejectedValue(uniqueConstraintError());
    mocks.paymentOperation.findUnique.mockResolvedValue(operation);

    await expect(
      beginPaymentOperation(
        beginInput({ operation: purchaseOperation(60) }) as never,
      ),
    ).rejects.toMatchObject({ code: "IDEMPOTENCY_KEY_REUSED" });
  });

  it("rejects reuse of a purchase key for an extension", async () => {
    let operation: ReturnType<typeof storedOperation> | undefined;
    mocks.paymentOperation.create.mockImplementation(
      async ({ data }: { data: Record<string, unknown> }) => {
        operation = storedOperation(data);
        return operation;
      },
    );

    await beginPaymentOperation(beginInput() as never);
    mocks.paymentOperation.create.mockRejectedValue(uniqueConstraintError());
    mocks.paymentOperation.findUnique.mockResolvedValue(operation);

    await expect(
      beginPaymentOperation(
        beginInput({
          operation: {
            kind: "EXTEND",
            payload: {
              duration_days: 30,
              gateway_type: "YOOKASSA",
              confirmed_amount: "100.00",
              confirmed_currency: "RUB",
              offer_version: "v1:test-offer",
            },
          },
        }) as never,
      ),
    ).rejects.toMatchObject({ code: "IDEMPOTENCY_KEY_REUSED", status: 409 });
  });

  it("binds a hashed upstream owner once and rejects a different owner", async () => {
    const claimToken = "claim-owner";
    const claimHash = sha256(
      `clean-pay:payment-operation:claim:v1:${claimToken}`,
    );
    let storedOwnerHash: string | undefined;
    mocks.paymentOperation.updateMany.mockImplementation(
      async ({ data }: { data: { upstreamOwnerHash?: string } }) => {
        storedOwnerHash = data.upstreamOwnerHash;
        return { count: 1 };
      },
    );

    await bindPaymentOperationUpstreamOwner({
      operationId: "operation-1",
      claimToken,
      upstreamAccountId: "remnashop-user-1",
    });

    expect(storedOwnerHash).toEqual(expect.any(String));
    expect(storedOwnerHash).not.toBe("remnashop-user-1");
    expect(
      JSON.stringify(mocks.paymentOperation.updateMany.mock.calls),
    ).not.toContain("remnashop-user-1");

    mocks.paymentOperation.updateMany.mockResolvedValue({ count: 0 });
    mocks.paymentOperation.findUnique.mockResolvedValue({
      status: "READY",
      claimTokenHash: claimHash,
      upstreamOwnerHash: storedOwnerHash,
    });

    await expect(
      bindPaymentOperationUpstreamOwner({
        operationId: "operation-1",
        claimToken,
        upstreamAccountId: "remnashop-user-1",
      }),
    ).resolves.toBeUndefined();
    await expect(
      bindPaymentOperationUpstreamOwner({
        operationId: "operation-1",
        claimToken,
        upstreamAccountId: "remnashop-user-2",
      }),
    ).rejects.toMatchObject({ code: "IDEMPOTENCY_KEY_REUSED", status: 409 });
  });

  it("replays the durable success snapshot without claiming again", async () => {
    let operation: ReturnType<typeof storedOperation> | undefined;
    mocks.paymentOperation.create.mockImplementation(
      async ({ data }: { data: Record<string, unknown> }) => {
        operation = storedOperation(data);
        return operation;
      },
    );
    await beginPaymentOperation(beginInput() as never);
    vi.clearAllMocks();
    mocks.paymentOperation.create.mockRejectedValue(uniqueConstraintError());
    mocks.paymentOperation.findUnique.mockResolvedValue(
      storedOperation(operation ?? {}, {
        status: "SUCCEEDED",
        responseStatus: 201,
        responseSnapshot: paymentInput().payment,
      }),
    );

    await expect(beginPaymentOperation(beginInput() as never)).resolves.toEqual({
      state: "replay",
      outcome: "success",
      operationId: "operation-1",
      responseStatus: 201,
      response: paymentInput().payment,
    });
    expect(mocks.paymentOperation.updateMany).not.toHaveBeenCalled();
  });

  it("replays the same free-payment result including its null URL", async () => {
    let operation: ReturnType<typeof storedOperation> | undefined;
    mocks.paymentOperation.create.mockImplementation(
      async ({ data }: { data: Record<string, unknown> }) => {
        operation = storedOperation(data);
        return operation;
      },
    );
    const freeOperation = beginInput({ operation: purchaseOperation(0) });

    await beginPaymentOperation(freeOperation as never);
    vi.clearAllMocks();
    mocks.paymentOperation.create.mockRejectedValue(uniqueConstraintError());
    mocks.paymentOperation.findUnique.mockResolvedValue(
      storedOperation(operation ?? {}, {
        status: "SUCCEEDED",
        responseStatus: 200,
        responseSnapshot: {
          payment_id: "free-payment-1",
          payment_url: null,
          purchase_type: "subscription",
          status: "completed",
          is_free: true,
          final_amount: "0",
          currency: "RUB",
        },
      }),
    );

    await expect(beginPaymentOperation(freeOperation as never)).resolves.toMatchObject({
      state: "replay",
      outcome: "success",
      response: {
        payment_id: "free-payment-1",
        payment_url: null,
        is_free: true,
      },
    });
    expect(mocks.paymentOperation.updateMany).not.toHaveBeenCalled();
  });

  it("replays a terminal error snapshot without another execution claim", async () => {
    let operation: ReturnType<typeof storedOperation> | undefined;
    mocks.paymentOperation.create.mockImplementation(
      async ({ data }: { data: Record<string, unknown> }) => {
        operation = storedOperation(data);
        return operation;
      },
    );

    await beginPaymentOperation(beginInput() as never);
    vi.clearAllMocks();
    mocks.paymentOperation.create.mockRejectedValue(uniqueConstraintError());
    mocks.paymentOperation.findUnique.mockResolvedValue(
      storedOperation(operation ?? {}, {
        status: "FAILED_FINAL",
        responseStatus: 409,
        errorSnapshot: {
          code: "PLAN_UNAVAILABLE",
          status: 409,
          message: "Этот тариф сейчас недоступен.",
        },
      }),
    );

    await expect(beginPaymentOperation(beginInput() as never)).resolves.toMatchObject({
      state: "replay",
      outcome: "failure",
      responseStatus: 409,
      error: { code: "PLAN_UNAVAILABLE", status: 409 },
    });
    expect(mocks.paymentOperation.updateMany).not.toHaveBeenCalled();
  });

  it("moves stale dispatches to unknown but lets their leader finish late", async () => {
    let operation: ReturnType<typeof storedOperation> | undefined;
    mocks.paymentOperation.create.mockImplementation(
      async ({ data }: { data: Record<string, unknown> }) => {
        operation = storedOperation(data);
        return operation;
      },
    );
    const initial = await beginPaymentOperation(beginInput() as never);
    expect(initial.state).toBe("execute");
    if (initial.state !== "execute") {
      throw new Error("Expected execution claim");
    }

    const ownerHash = sha256(
      `clean-pay:payment-operation:claim:v1:${initial.claimToken}`,
    );
    vi.clearAllMocks();
    mocks.paymentOperation.create.mockRejectedValue(uniqueConstraintError());
    mocks.paymentOperation.findUnique.mockResolvedValue(
      storedOperation(operation ?? {}, {
        status: "DISPATCHING",
        claimTokenHash: ownerHash,
        leaseExpiresAt: new Date("2000-01-01T00:00:00.000Z"),
      }),
    );
    mocks.paymentOperation.updateMany.mockResolvedValue({ count: 1 });

    await expect(beginPaymentOperation(beginInput() as never)).resolves.toEqual({
      state: "pending",
      operationId: "operation-1",
      reason: "OUTCOME_UNKNOWN",
    });
    expect(mocks.paymentOperation.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.not.objectContaining({ claimTokenHash: null }),
      }),
    );

    mocks.paymentOperation.findUnique.mockResolvedValue(
      storedOperation(operation ?? {}, {
        status: "OUTCOME_UNKNOWN",
        claimTokenHash: ownerHash,
        upstreamOwnerHash: "upstream-owner-hash",
      }),
    );
    mocks.paymentOperation.updateMany.mockResolvedValue({ count: 1 });
    mocks.paymentRecord.findUnique.mockResolvedValue(null);
    mocks.paymentRecord.create.mockResolvedValue({ id: "record-1" });
    mocks.prisma.$transaction.mockImplementation(
      async (callback: (transaction: typeof mocks.transaction) => unknown) =>
        callback(mocks.transaction),
    );

    await expect(
      completePaymentOperationSuccess({
        operationId: "operation-1",
        claimToken: initial.claimToken,
        payment: paymentInput(),
      }),
    ).resolves.toEqual(paymentInput().payment);
    expect(mocks.paymentOperation.updateMany).toHaveBeenLastCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          status: { in: ["DISPATCHING", "OUTCOME_UNKNOWN"] },
          claimTokenHash: ownerHash,
        }),
        data: expect.objectContaining({ status: "SUCCEEDED" }),
      }),
    );
    expect(mocks.paymentRecord.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        operationId: "operation-1",
        paymentId: "payment-1",
      }),
    });
    expect(mocks.lockPaymentUpstreamOwner).toHaveBeenCalledWith(
      mocks.transaction,
      "user-1",
      "upstream-owner-hash",
    );
  });

  it("returns a terminal manual-review result for a reconciled unknown outcome", async () => {
    mocks.paymentOperation.create.mockImplementation(
      async ({ data }: { data: Record<string, unknown> }) =>
        storedOperation(data, {
        status: "OUTCOME_UNKNOWN",
        reconciledAt: new Date("2026-07-17T12:00:00.000Z"),
        reconcileErrorSnapshot: {
          code: "MANUAL_REQUIRED",
          reason: "UPSTREAM_OPERATION_NOT_FOUND",
        },
        }),
    );

    await expect(beginPaymentOperation(beginInput() as never)).resolves.toEqual({
      state: "manual_required",
      operationId: "operation-1",
    });
    expect(mocks.paymentOperation.updateMany).not.toHaveBeenCalled();
  });

  it("returns pending while another non-stale dispatch owns the operation", async () => {
    let operation: ReturnType<typeof storedOperation> | undefined;
    mocks.paymentOperation.create.mockImplementation(
      async ({ data }: { data: Record<string, unknown> }) => {
        operation = storedOperation(data);
        return operation;
      },
    );
    await beginPaymentOperation(beginInput() as never);
    mocks.paymentOperation.create.mockRejectedValue(uniqueConstraintError());
    mocks.paymentOperation.findUnique.mockResolvedValue(
      storedOperation(operation ?? {}, {
        status: "DISPATCHING",
        leaseExpiresAt: new Date(Date.now() + 30_000),
      }),
    );

    await expect(beginPaymentOperation(beginInput() as never)).resolves.toMatchObject({
      state: "pending",
      operationId: "operation-1",
      reason: "IN_PROGRESS",
      retryAfterSeconds: expect.any(Number),
    });
  });

  it("uses claim-token CAS for dispatch and failure settlements", async () => {
    mocks.paymentOperation.updateMany.mockResolvedValue({ count: 1 });

    await markPaymentOperationDispatched({
      operationId: "operation-1",
      claimToken: "claim-1",
    });
    await settlePaymentOperationBeforeDispatchFailure({
      operationId: "operation-2",
      claimToken: "claim-2",
      error: new BffError("RATE_LIMITED", 429),
      final: false,
    });
    await settlePaymentOperationAfterDispatchFailure({
      operationId: "operation-3",
      claimToken: "claim-3",
      error: new Error("connection reset"),
      outcome: "UNKNOWN",
    });

    expect(mocks.paymentOperation.updateMany).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        where: expect.objectContaining({
          status: "READY",
          claimTokenHash: expect.any(String),
          leaseExpiresAt: { gt: expect.any(Date) },
        }),
        data: expect.objectContaining({ status: "DISPATCHING" }),
      }),
    );
    expect(mocks.paymentOperation.updateMany).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        data: {
          claimTokenHash: null,
          leaseExpiresAt: null,
        },
      }),
    );
    expect(mocks.paymentOperation.updateMany).toHaveBeenNthCalledWith(
      3,
      expect.objectContaining({
        where: expect.objectContaining({
          status: { in: ["DISPATCHING", "OUTCOME_UNKNOWN"] },
        }),
        data: expect.objectContaining({ status: "OUTCOME_UNKNOWN" }),
      }),
    );
  });

  it("classifies post-dispatch failures consistently with client key retention", () => {
    expect(
      paymentOperationDispatchFailureOutcome(
        new BffError("CONFLICT", 409, "local persistence collision"),
      ),
    ).toBe("UNKNOWN");
    expect(
      paymentOperationDispatchFailureOutcome(
        new BffError("RATE_LIMITED", 429, "slow down", {
          upstreamStatus: 429,
        }),
      ),
    ).toBe("RETRYABLE");
    expect(
      paymentOperationDispatchFailureOutcome(
        new BffError("UPSTREAM_ERROR", 502, "request timeout", {
          upstreamStatus: 408,
        }),
      ),
    ).toBe("UNKNOWN");
    expect(
      paymentOperationDispatchFailureOutcome(
        new BffError("UPSTREAM_ERROR", 502, "method not allowed", {
          upstreamStatus: 405,
        }),
      ),
    ).toBe("UNKNOWN");
    expect(
      paymentOperationDispatchFailureOutcome(
        new BffError("IDEMPOTENCY_KEY_REUSED", 409, "upstream key conflict", {
          upstreamStatus: 409,
        }),
      ),
    ).toBe("UNKNOWN");
    expect(
      paymentOperationDispatchFailureOutcome(
        new BffError("VALIDATION_ERROR", 400, "invalid duration", {
          upstreamStatus: 400,
        }),
      ),
    ).toBe("FINAL");
  });

  it("releases a definitively retryable post-dispatch operation to READY", async () => {
    mocks.paymentOperation.updateMany.mockResolvedValue({ count: 1 });

    await settlePaymentOperationAfterDispatchFailure({
      operationId: "operation-retry",
      claimToken: "claim-retry",
      error: new BffError("RATE_LIMITED", 429),
      outcome: "RETRYABLE",
    });

    expect(mocks.paymentOperation.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: "READY",
          responseStatus: null,
          completedAt: null,
          outcomeUnknownAt: null,
          claimTokenHash: null,
          leaseExpiresAt: null,
        }),
      }),
    );
  });

  it("rolls back completion instead of taking over a foreign payment id", async () => {
    const claimToken = "claim-owner";
    mocks.paymentOperation.findUnique.mockResolvedValue(
      storedOperation(
        {
          userId: "user-1",
          kind: "PURCHASE",
          idempotencyKeyHash: "key-hash",
          upstreamOwnerHash: "owner-hash",
          requestFingerprint: "request-hash",
          requestPayload: {},
          upstreamKey: "upstream-key",
        },
        {
          status: "DISPATCHING",
          claimTokenHash: sha256(
            `clean-pay:payment-operation:claim:v1:${claimToken}`,
          ),
        },
      ),
    );
    mocks.paymentRecord.findUnique
      .mockResolvedValueOnce({
        userId: "user-foreign",
        operationId: "operation-foreign",
      })
      .mockResolvedValueOnce(null);

    await expect(
      completePaymentOperationSuccess({
        operationId: "operation-1",
        claimToken,
        payment: paymentInput(),
      }),
    ).rejects.toMatchObject({ code: "CONFLICT", status: 409 });
    expect(mocks.paymentOperation.updateMany).not.toHaveBeenCalled();
    expect(mocks.paymentRecord.updateMany).not.toHaveBeenCalled();
    expect(mocks.paymentRecord.create).not.toHaveBeenCalled();
  });

  it("revalidates the current upstream owner before committing foreground success", async () => {
    const claimToken = "claim-owner-race";
    mocks.paymentOperation.findUnique.mockResolvedValue(
      storedOperation(
        {
          userId: "user-1",
          kind: "PURCHASE",
          idempotencyKeyHash: "key-hash",
          upstreamOwnerHash: "owner-hash",
          requestFingerprint: "request-hash",
          requestPayload: {},
          upstreamKey: "upstream-key",
        },
        {
          status: "DISPATCHING",
          claimTokenHash: sha256(
            `clean-pay:payment-operation:claim:v1:${claimToken}`,
          ),
        },
      ),
    );
    mocks.lockPaymentUpstreamOwner.mockRejectedValue(
      new BffError(
        "ACCOUNT_MERGE_REQUIRED",
        409,
        "owner changed during payment",
      ),
    );

    await expect(
      completePaymentOperationSuccess({
        operationId: "operation-1",
        claimToken,
        payment: paymentInput(),
      }),
    ).rejects.toMatchObject({ code: "ACCOUNT_MERGE_REQUIRED" });
    expect(mocks.paymentOperation.updateMany).not.toHaveBeenCalled();
    expect(mocks.paymentRecord.create).not.toHaveBeenCalled();
  });

  it("reconstructs terminal BFF errors from safe snapshots", () => {
    expect(
      paymentOperationErrorFromSnapshot({
        code: "PLAN_UNAVAILABLE",
        status: 409,
        message: "safe snapshot",
      }),
    ).toMatchObject({
      code: "PLAN_UNAVAILABLE",
      status: 409,
      message: "safe snapshot",
    });
  });
});
