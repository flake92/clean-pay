import { afterAll, beforeAll, describe, expect, it } from "vitest";

const realDatabaseUrl = process.env.REAL_DATABASE_URL;
const describeWithPostgres = realDatabaseUrl ? describe : describe.skip;

describeWithPostgres("account merge PostgreSQL invariants", () => {
  let prisma: typeof import("@/backend/database/prisma")["prisma"];
  let mergeLocalUsersIntoTarget: typeof import("@/backend/auth/user-merge")["mergeLocalUsersIntoTarget"];
  let withPaymentOwnerChangeFence: typeof import("@/backend/payments/user-merge")["withPaymentOwnerChangeFence"];
  let lockPaymentOwnerFence: typeof import("@/backend/payments/user-merge")["lockPaymentOwnerFence"];
  const userIds: string[] = [];

  beforeAll(async () => {
    process.env.DATABASE_URL = realDatabaseUrl as string;
    delete (globalThis as typeof globalThis & { prisma?: unknown }).prisma;
    ({ prisma } = await import("@/backend/database/prisma"));
    ({ mergeLocalUsersIntoTarget } = await import("@/backend/auth/user-merge"));
    ({ withPaymentOwnerChangeFence, lockPaymentOwnerFence } =
      await import("@/backend/payments/user-merge"));
  });

  afterAll(async () => {
    if (!prisma || userIds.length === 0) return;
    await prisma.accountMergeConfirmation.deleteMany({ where: { userId: { in: userIds } } });
    await prisma.paymentRecord.deleteMany({ where: { userId: { in: userIds } } });
    await prisma.paymentOperation.deleteMany({ where: { userId: { in: userIds } } });
    await prisma.webUser.deleteMany({ where: { id: { in: userIds } } });
  });

  it("allows exactly one concurrent confirmation claimant", async () => {
    const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
    const user = await prisma.webUser.create({
      data: {
        email: `claim-${suffix}@example.com`,
        emailVerified: true,
        remnashopUserId: `claim-${suffix}`,
      },
    });
    userIds.push(user.id);
    const confirmation = await prisma.accountMergeConfirmation.create({
      data: {
        userId: user.id,
        tokenHash: `token-${suffix}`,
        telegramId: `telegram-${suffix}`,
        targetEmail: user.email!,
        sourceRemnashopUserId: `source-${suffix}`,
        targetRemnashopUserId: `target-${suffix}`,
        expiresAt: new Date(Date.now() + 60_000),
      },
    });

    const claims = await Promise.all(Array.from({ length: 16 }, () =>
      prisma.accountMergeConfirmation.updateMany({
        where: {
          id: confirmation.id,
          status: "PENDING",
          expiresAt: { gt: new Date() },
        },
        data: {
          status: "PROCESSING",
          attemptCount: { increment: 1 },
          leaseExpiresAt: new Date(Date.now() + 60_000),
        },
      }),
    ));

    expect(claims.reduce((sum, claim) => sum + claim.count, 0)).toBe(1);
    await expect(prisma.accountMergeConfirmation.findUnique({
      where: { id: confirmation.id },
    })).resolves.toMatchObject({ status: "PROCESSING", attemptCount: 1 });
  });

  it("preserves passkeys, payments and colliding operations in one local transaction", async () => {
    const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
    const [target, source] = await Promise.all([
      prisma.webUser.create({
        data: {
          email: `target-${suffix}@example.com`,
          emailVerified: true,
          remnashopUserId: `target-${suffix}`,
        },
      }),
      prisma.webUser.create({
        data: {
          telegramId: `telegram-${suffix}`,
          remnashopUserId: `source-${suffix}`,
        },
      }),
    ]);
    userIds.push(target.id, source.id);

    await Promise.all([
      prisma.webAuthnCredential.create({
        data: {
          userId: target.id,
          credentialId: `target-credential-${suffix}`,
          publicKey: Buffer.from("target-key"),
          transports: [],
        },
      }),
      prisma.webAuthnCredential.create({
        data: {
          userId: source.id,
          credentialId: `source-credential-${suffix}`,
          publicKey: Buffer.from("source-key"),
          transports: [],
        },
      }),
      prisma.webSession.create({
        data: {
          userId: source.id,
          refreshTokenHash: `source-refresh-${suffix}`,
          accessTokenExpiresAt: new Date(Date.now() + 60_000),
          refreshExpiresAt: new Date(Date.now() + 120_000),
        },
      }),
      prisma.accountMergeConfirmation.create({
        data: {
          userId: target.id,
          tokenHash: `merge-token-${suffix}`,
          telegramId: source.telegramId!,
          targetEmail: target.email!,
          sourceRemnashopUserId: source.remnashopUserId!,
          targetRemnashopUserId: target.remnashopUserId!,
          expiresAt: new Date(Date.now() + 60_000),
        },
      }),
    ]);

    const [targetOperation, sourceOperation] = await Promise.all([
      prisma.paymentOperation.create({
        data: {
          userId: target.id,
          kind: "PURCHASE",
          idempotencyKeyHash: `shared-${suffix}`,
          requestFingerprint: `target-fingerprint-${suffix}`,
          requestPayload: { plan: "target" },
          upstreamKey: `target-upstream-${suffix}`,
          status: "FAILED_FINAL",
        },
      }),
      prisma.paymentOperation.create({
        data: {
          userId: source.id,
          kind: "PURCHASE",
          idempotencyKeyHash: `shared-${suffix}`,
          requestFingerprint: `source-fingerprint-${suffix}`,
          requestPayload: { plan: "source" },
          upstreamKey: `source-upstream-${suffix}`,
          status: "FAILED_FINAL",
        },
      }),
    ]);
    await Promise.all([
      prisma.paymentRecord.create({
        data: {
          userId: target.id,
          operationId: targetOperation.id,
          paymentId: `target-payment-${suffix}`,
          purchaseType: "PURCHASE",
          status: "FAILED",
          finalAmount: "10.00",
          currency: "RUB",
          gatewayType: "PLATEGA",
        },
      }),
      prisma.paymentRecord.create({
        data: {
          userId: source.id,
          operationId: sourceOperation.id,
          paymentId: `source-payment-${suffix}`,
          purchaseType: "PURCHASE",
          status: "FAILED",
          finalAmount: "20.00",
          currency: "RUB",
          gatewayType: "YOOKASSA",
        },
      }),
    ]);

    await prisma.$transaction((tx) => mergeLocalUsersIntoTarget(tx, {
      targetUserId: target.id,
      targetUpstreamAccountId: target.remnashopUserId,
      sourceUserIds: [source.id],
    }));

    const [finalTarget, sourceCount, operations, records, sourceSessions, confirmations] =
      await Promise.all([
        prisma.webUser.findUnique({
          where: { id: target.id },
          include: { webAuthnCredentials: true },
        }),
        prisma.webUser.count({ where: { id: source.id } }),
        prisma.paymentOperation.findMany({ where: { userId: target.id } }),
        prisma.paymentRecord.findMany({ where: { userId: target.id } }),
        prisma.webSession.count({ where: { userId: source.id } }),
        prisma.accountMergeConfirmation.count({ where: { userId: target.id } }),
      ]);

    expect(sourceCount).toBe(0);
    expect(sourceSessions).toBe(0);
    expect(finalTarget?.webAuthnCredentials).toHaveLength(2);
    expect(operations).toHaveLength(2);
    expect(new Set(operations.map(({ idempotencyKeyHash }) => idempotencyKeyHash)).size)
      .toBe(2);
    expect(records).toHaveLength(2);
    expect(confirmations).toBe(1);
  });

  it("rejects owner work before dispatch when a claimed payment is active", async () => {
    const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
    const user = await prisma.webUser.create({
      data: {
        email: `fenced-${suffix}@example.com`,
        emailVerified: true,
        remnashopUserId: `fenced-${suffix}`,
      },
    });
    userIds.push(user.id);
    await prisma.paymentOperation.create({
      data: {
        userId: user.id,
        kind: "PURCHASE",
        idempotencyKeyHash: `fenced-key-${suffix}`,
        requestFingerprint: `fenced-fingerprint-${suffix}`,
        requestPayload: { plan: "fenced" },
        upstreamKey: `fenced-upstream-${suffix}`,
        status: "READY",
        leaseExpiresAt: new Date(Date.now() + 60_000),
      },
    });
    let workStarted = false;

    await expect(withPaymentOwnerChangeFence({
      userIds: [user.id],
      work: async () => {
        workStarted = true;
      },
    })).rejects.toMatchObject({
      code: "ACCOUNT_MERGE_REQUIRED",
      status: 409,
    });
    expect(workStarted).toBe(false);
  });

  it("holds the owner advisory lock until upstream and local work completes", async () => {
    const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
    const user = await prisma.webUser.create({
      data: {
        email: `serialized-${suffix}@example.com`,
        emailVerified: true,
        remnashopUserId: `serialized-${suffix}`,
      },
    });
    userIds.push(user.id);
    let releaseWork!: () => void;
    let signalEntered!: () => void;
    const entered = new Promise<void>((resolve) => {
      signalEntered = resolve;
    });
    const release = new Promise<void>((resolve) => {
      releaseWork = resolve;
    });
    const ownerWork = withPaymentOwnerChangeFence({
      userIds: [user.id],
      work: async () => {
        signalEntered();
        await release;
      },
    });
    await entered;

    let claimantEntered = false;
    const claimant = prisma.$transaction(async (tx) => {
      await lockPaymentOwnerFence(tx, [user.id]);
      claimantEntered = true;
    }, { maxWait: 5_000, timeout: 15_000 });
    await new Promise((resolve) => setTimeout(resolve, 75));
    expect(claimantEntered).toBe(false);

    releaseWork();
    await ownerWork;
    await claimant;
    expect(claimantEntered).toBe(true);
  });
});
