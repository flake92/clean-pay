import type { ProfileAccountRepository } from "@/backend/application/profile/ports/profile-account-repository";
import { prisma } from "@/backend/database/prisma";
export const prismaProfileAccountRepository: ProfileAccountRepository = {
  async confirmVerifiedEmail(userId) {
    await prisma.webUser.update({ where: { id: userId }, data: {
      emailVerified: true, authPending: false, pendingRemnashopUserId: null, pendingRemnashopEmail: null,
    } });
  },
};
