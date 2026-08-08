import type { PasskeyAccountReader } from "@/backend/application/auth/ports/passkey-account-reader";
import { prisma } from "@/backend/database/prisma";
export const prismaPasskeyAccountReader: PasskeyAccountReader = {
  async hasCredential(email) {
    const user = await prisma.webUser.findUnique({ where: { email }, select: { webAuthnCredentials: { select: { id: true }, take: 1 } } });
    return Boolean(user?.webAuthnCredentials.length);
  },
};
