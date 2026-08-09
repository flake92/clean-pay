import { prisma } from "@/backend/database/prisma";
export const prismaProfileAccountRepository = {
  async confirmVerifiedEmail(userId: string) {
    await prisma.webUser.update({ where: { id: userId }, data: {
      emailVerified: true, authPending: false, pendingRemnashopUserId: null, pendingRemnashopEmail: null,
    } });
  },
};
