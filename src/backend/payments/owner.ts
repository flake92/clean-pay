import { prisma } from "@/backend/database/prisma";
import { BffError } from "@/backend/integrations/remnashop/errors";
import { paymentUpstreamOwnerHash } from "@/backend/payments/hashes";
import { safeEqual } from "@/backend/security/crypto";
import { Prisma } from "@prisma/client";

function identityConflict(): never {
  throw new BffError(
    "ACCOUNT_MERGE_REQUIRED",
    409,
    "Authenticated Remnashop identity does not match the local payment owner",
  );
}

export async function assertPaymentUpstreamIdentity(
  userId: string,
  upstreamAccountId: string,
) {
  const user = await prisma.webUser.findUnique({
    where: { id: userId },
    select: { remnashopUserId: true },
  });

  if (
    !user?.remnashopUserId ||
    !safeEqual(user.remnashopUserId, upstreamAccountId)
  ) {
    identityConflict();
  }
}

export async function lockPaymentUpstreamOwner(
  tx: Prisma.TransactionClient,
  userId: string,
  expectedOwnerHash: string,
) {
  const rows = await tx.$queryRaw<Array<{ remnashopUserId: string | null }>>(
    Prisma.sql`
      SELECT "remnashopUserId"
      FROM "WebUser"
      WHERE "id" = ${userId}
      FOR KEY SHARE
    `,
  );
  const remnashopUserId = rows[0]?.remnashopUserId;

  if (
    !remnashopUserId ||
    !safeEqual(
      paymentUpstreamOwnerHash(remnashopUserId),
      expectedOwnerHash,
    )
  ) {
    identityConflict();
  }

  return remnashopUserId;
}
