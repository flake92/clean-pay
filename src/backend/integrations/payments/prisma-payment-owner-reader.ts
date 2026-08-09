import { Prisma, type Prisma as PrismaTypes } from "@prisma/client";
import { prisma } from "@/backend/database/prisma";
export const prismaPaymentOwnerReader = {
  async findUpstreamOwnerId(userId: string) {
    const user = await prisma.webUser.findUnique({ where: { id: userId }, select: { remnashopUserId: true } });
    return user?.remnashopUserId ?? null;
  },
};
export async function lockPrismaPaymentOwner(tx: PrismaTypes.TransactionClient, userId: string) {
  const rows = await tx.$queryRaw<Array<{ remnashopUserId: string | null }>>(Prisma.sql`
    SELECT "remnashopUserId" FROM "WebUser" WHERE "id" = ${userId} FOR KEY SHARE
  `);
  return rows[0]?.remnashopUserId ?? null;
}
