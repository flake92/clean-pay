import { prisma } from "@/backend/database/prisma";
export const prismaPasskeyAccountReader = {
  async hasCredential(email: string) {
    const user = await prisma.webUser.findUnique({ where: { email }, select: { webAuthnCredentials: { select: { id: true }, take: 1 } } });
    return Boolean(user?.webAuthnCredentials.length);
  },
};
