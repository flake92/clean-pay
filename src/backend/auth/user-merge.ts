import { Prisma } from "@prisma/client";

import { BffError } from "@/backend/integrations/remnashop/errors";
import { transferPaymentOperationsForUserMerge } from "@/backend/payments/user-merge";

export type LocalUserMergeResult = {
  revokedSessionCount: number;
  transferredPasskeyCount: number;
  invalidatedWebAuthnChallengeCount: number;
  invalidatedEmailCodeCount: number;
  invalidatedTelegramStateCount: number;
};

type FinalOwnerExpectation = {
  remnashopUserId?: string | null;
  email?: string | null;
  telegramId?: string | null;
};

export type LocalUserOwnerExpectation = {
  id: string;
  remnashopUserId: string | null;
  email: string | null;
  telegramId: string | null;
};

function mergeStateChangedError() {
  return new BffError(
    "ACCOUNT_MERGE_REQUIRED",
    409,
    "Local account merge ownership changed; retry with freshly verified identities",
  );
}

function normalizedSourceIds(targetUserId: string, sourceUserIds: string[]) {
  return [...new Set(sourceUserIds)].filter((userId) => userId !== targetUserId);
}

export async function mergeLocalUsersIntoTarget(
  tx: Prisma.TransactionClient,
  {
    targetUserId,
    targetUpstreamAccountId,
    sourceUserIds: rawSourceUserIds,
    ownerExpectations = [],
  }: {
    targetUserId: string;
    targetUpstreamAccountId: string | null;
    sourceUserIds: string[];
    ownerExpectations?: LocalUserOwnerExpectation[];
  },
): Promise<LocalUserMergeResult> {
  const sourceUserIds = normalizedSourceIds(targetUserId, rawSourceUserIds);
  const emptyResult: LocalUserMergeResult = {
    revokedSessionCount: 0,
    transferredPasskeyCount: 0,
    invalidatedWebAuthnChallengeCount: 0,
    invalidatedEmailCodeCount: 0,
    invalidatedTelegramStateCount: 0,
  };

  if (sourceUserIds.length === 0) {
    return emptyResult;
  }

  const userIds = [targetUserId, ...sourceUserIds].sort();
  const lockedUsers = await tx.$queryRaw<LocalUserOwnerExpectation[]>(
    Prisma.sql`
      SELECT "id", "remnashopUserId", "email", "telegramId"
      FROM "WebUser"
      WHERE "id" IN (${Prisma.join(userIds)})
      ORDER BY "id"
      FOR UPDATE
    `,
  );
  const lockedIds = new Set(lockedUsers.map(({ id }) => id));

  if (lockedIds.size !== userIds.length || userIds.some((id) => !lockedIds.has(id))) {
    throw mergeStateChangedError();
  }

  const lockedById = new Map(lockedUsers.map((user) => [user.id, user]));

  for (const expected of ownerExpectations) {
    const locked = lockedById.get(expected.id);

    if (
      !locked ||
      locked.remnashopUserId !== expected.remnashopUserId ||
      locked.email !== expected.email ||
      locked.telegramId !== expected.telegramId
    ) {
      throw mergeStateChangedError();
    }
  }

  const releasedIdentities = await tx.webUser.updateMany({
    where: { id: { in: sourceUserIds } },
    data: {
      remnashopUserId: null,
      email: null,
      telegramId: null,
    },
  });

  if (releasedIdentities.count !== sourceUserIds.length) {
    throw mergeStateChangedError();
  }

  // Source cookies and both stored Remnashop tokens must stop authorizing
  // immediately after commit. Deleting the source rows is stronger than moving
  // their still-valid refresh hashes to the target account.
  const revokedSessions = await tx.webSession.deleteMany({
    where: { userId: { in: sourceUserIds } },
  });

  // Credential IDs are globally unique, so a proven account merge can preserve
  // passkeys by moving ownership. In-flight challenges and verification states
  // are intentionally invalidated because their original owner/session context
  // must never be replayed against the target account.
  const transferredPasskeys = await tx.webAuthnCredential.updateMany({
    where: { userId: { in: sourceUserIds } },
    data: { userId: targetUserId },
  });
  const invalidatedWebAuthnChallenges = await tx.webAuthnChallenge.deleteMany({
    where: { userId: { in: sourceUserIds } },
  });
  const invalidatedEmailCodes = await tx.emailVerificationCode.deleteMany({
    where: { userId: { in: sourceUserIds } },
  });
  const invalidatedTelegramStates = await tx.telegramAuthState.deleteMany({
    where: { userId: { in: sourceUserIds } },
  });

  await tx.auditLog.updateMany({
    where: { userId: { in: sourceUserIds } },
    data: { userId: targetUserId },
  });
  await transferPaymentOperationsForUserMerge(
    tx,
    targetUserId,
    targetUpstreamAccountId,
    sourceUserIds,
  );
  await tx.paymentRecord.updateMany({
    where: { userId: { in: sourceUserIds } },
    data: { userId: targetUserId },
  });

  const deletedUsers = await tx.webUser.deleteMany({
    where: { id: { in: sourceUserIds } },
  });

  if (deletedUsers.count !== sourceUserIds.length) {
    throw mergeStateChangedError();
  }

  return {
    revokedSessionCount: revokedSessions.count,
    transferredPasskeyCount: transferredPasskeys.count,
    invalidatedWebAuthnChallengeCount: invalidatedWebAuthnChallenges.count,
    invalidatedEmailCodeCount: invalidatedEmailCodes.count,
    invalidatedTelegramStateCount: invalidatedTelegramStates.count,
  };
}

export async function assertUserMergeFinalOwner(
  tx: Prisma.TransactionClient,
  {
    targetUserId,
    sourceUserIds: rawSourceUserIds,
    expected,
  }: {
    targetUserId: string;
    sourceUserIds: string[];
    expected: FinalOwnerExpectation;
  },
) {
  const sourceUserIds = normalizedSourceIds(targetUserId, rawSourceUserIds);
  const [target, remainingSourceCount] = await Promise.all([
    tx.webUser.findUnique({
      where: { id: targetUserId },
      select: {
        id: true,
        remnashopUserId: true,
        email: true,
        telegramId: true,
      },
    }),
    sourceUserIds.length > 0
      ? tx.webUser.count({ where: { id: { in: sourceUserIds } } })
      : Promise.resolve(0),
  ]);

  if (!target || remainingSourceCount !== 0) {
    throw mergeStateChangedError();
  }

  if (
    (expected.remnashopUserId !== undefined &&
      target.remnashopUserId !== expected.remnashopUserId) ||
    (expected.email !== undefined && target.email !== expected.email) ||
    (expected.telegramId !== undefined && target.telegramId !== expected.telegramId)
  ) {
    throw mergeStateChangedError();
  }

  return target;
}
