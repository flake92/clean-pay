import { prisma } from "@/backend/database/prisma";
import type {
  FindConfirmationInput,
  MergeConfirmation,
  MergeConfirmationStore,
  UpdateConfirmationData,
  UpdateConfirmationWhere,
} from "@/backend/services/merge-confirmation-store";

interface PrismaMergeConfirmationRow {
  id: string;
  userId: string;
  tokenHash: string;
  telegramId: string;
  telegramUsername: string | null;
  sourceEmail: string | null;
  targetEmail: string;
  sourceRemnashopUserId: string;
  targetRemnashopUserId: string;
  status: string;
  expiresAt: Date;
  leaseExpiresAt: Date | null;
  attemptCount: number;
  lastErrorCode: string | null;
  completedAt: Date | null;
}

function toMergeConfirmation(row: PrismaMergeConfirmationRow): MergeConfirmation {
  return {
    id: row.id,
    userId: row.userId,
    tokenHash: row.tokenHash,
    telegramId: row.telegramId,
    telegramUsername: row.telegramUsername,
    sourceEmail: row.sourceEmail,
    targetEmail: row.targetEmail,
    sourceRemnashopUserId: row.sourceRemnashopUserId,
    targetRemnashopUserId: row.targetRemnashopUserId,
    status: row.status as MergeConfirmation["status"],
    expiresAt: row.expiresAt,
    leaseExpiresAt: row.leaseExpiresAt,
    attemptCount: row.attemptCount,
    lastErrorCode: row.lastErrorCode,
    completedAt: row.completedAt,
  };
}

export const prismaMergeConfirmationStore: MergeConfirmationStore = {
  async findFirst(input: FindConfirmationInput): Promise<MergeConfirmation | null> {
    const row = await prisma.accountMergeConfirmation.findFirst({
      where: {
        tokenHash: input.tokenHash,
        userId: input.userId,
      },
    });
    return row ? toMergeConfirmation(row as PrismaMergeConfirmationRow) : null;
  },

  /* eslint-disable @typescript-eslint/no-explicit-any */
  async updateMany(where: UpdateConfirmationWhere, data: UpdateConfirmationData): Promise<number> {
    const result = await prisma.accountMergeConfirmation.updateMany({
      where: {
        id: where.id,
        userId: where.userId,
        ...(where.status ? { status: where.status } : {}),
      },
      data: data as any,
    });
    return result.count;
  },
  /* eslint-enable @typescript-eslint/no-explicit-any */
};
