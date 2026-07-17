import { Prisma } from "@prisma/client";

import { BffError } from "@/backend/integrations/remnashop/errors";

export async function transferPaymentOperationsForUserMerge(
  tx: Prisma.TransactionClient,
  targetUserId: string,
  sourceUserIds: string[],
) {
  if (sourceUserIds.length === 0) {
    return;
  }

  try {
    await tx.paymentOperation.updateMany({
      where: { userId: { in: sourceUserIds } },
      data: { userId: targetUserId },
    });
  } catch (error) {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2002"
    ) {
      throw new BffError(
        "ACCOUNT_MERGE_REQUIRED",
        409,
        "Payment operation keys conflict during account merge",
      );
    }

    throw error;
  }
}
