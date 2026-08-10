import { ServiceError } from "@/backend/errors/service-error";
import { paymentUpstreamOwnerHash } from "@/backend/payments/hashes";
import { safeEqual } from "@/backend/security/crypto";
import type { Prisma } from "@prisma/client";
import { lockPrismaPaymentOwner, prismaPaymentOwnerReader } from "@/backend/integrations/payments/prisma-payment-owner-reader";

function identityConflict(): never {
  throw new ServiceError(
    "ACCOUNT_MERGE_REQUIRED",
    409,
    "Authenticated Remnashop identity does not match the local payment owner",
  );
}

export async function assertPaymentUpstreamIdentity(
  userId: string,
  upstreamAccountId: string,
) {
  const remnashopUserId = await prismaPaymentOwnerReader.findUpstreamOwnerId(userId);

  if (
    !remnashopUserId ||
    !safeEqual(remnashopUserId, upstreamAccountId)
  ) {
    identityConflict();
  }
}

export async function lockPaymentUpstreamOwner(
  tx: Prisma.TransactionClient,
  userId: string,
  expectedOwnerHash: string,
) {
  const remnashopUserId = await lockPrismaPaymentOwner(tx, userId);

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
