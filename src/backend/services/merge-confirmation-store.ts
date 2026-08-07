import type { AccountMergeConfirmationStatus } from "@prisma/client";

export interface MergeConfirmation {
  id: string;
  userId: string;
  tokenHash: string;
  telegramId: string;
  telegramUsername: string | null;
  sourceEmail: string | null;
  targetEmail: string;
  sourceRemnashopUserId: string;
  targetRemnashopUserId: string;
  status: AccountMergeConfirmationStatus;
  expiresAt: Date;
  leaseExpiresAt: Date | null;
  attemptCount: number;
  lastErrorCode: string | null;
  completedAt: Date | null;
}

export interface FindConfirmationInput {
  tokenHash: string;
  userId: string;
}

export interface UpdateConfirmationWhere {
  id: string;
  userId: string;
  status?: AccountMergeConfirmationStatus;
}

export interface UpdateConfirmationData {
  status?: AccountMergeConfirmationStatus;
  leaseExpiresAt?: Date | null;
  completedAt?: Date | null;
  lastErrorCode?: string | null;
  attemptCount?: { increment: number };
}

export interface MergeConfirmationStore {
  findFirst(input: FindConfirmationInput): Promise<MergeConfirmation | null>;
  updateMany(where: UpdateConfirmationWhere, data: UpdateConfirmationData): Promise<number>;
}
