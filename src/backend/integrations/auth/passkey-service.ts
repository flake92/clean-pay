import { Prisma } from "@prisma/client";

import { prisma } from "@/backend/database/prisma";
import { ServiceError } from "@/backend/errors/service-error";
import { auditLog } from "@/backend/observability/audit";

export async function recordPasskeyUse({
  id, userId, credentialId, oldCounter, newCounter,
}: {
  id: string; userId: string; credentialId: string; oldCounter: bigint; newCounter: bigint;
}) {
  const lastUsedAt = new Date();
  if (oldCounter === 0n && newCounter === 0n) {
    await prisma.webAuthnCredential.update({ where: { id }, data: { lastUsedAt } });
    return;
  }
  const updated = await prisma.webAuthnCredential.updateMany({
    where: { id, counter: oldCounter }, data: { counter: newCounter, lastUsedAt },
  });
  if (updated.count !== 1) {
    await auditLog({ action: "passkey_counter_conflict", severity: "WARN", userId, metadata: { credentialId } });
    throw new ServiceError("UNAUTHORIZED", 401, "Passkey counter state changed");
  }
}

export async function deleteOwnedPasskey(userId: string, credentialId: string) {
  return prisma.$transaction(async (tx) => {
    const lockedUsers = await tx.$queryRaw<Array<{ id: string }>>(
      Prisma.sql`SELECT "id" FROM "WebUser" WHERE "id" = ${userId} FOR UPDATE`,
    );
    if (lockedUsers.length !== 1) throw new ServiceError("UNAUTHORIZED", 401, "Current user no longer exists");
    const credential = await tx.webAuthnCredential.findFirst({ where: { id: credentialId, userId } });
    if (!credential) throw new ServiceError("NOT_FOUND", 404, "Passkey was not found");
    if (await tx.webAuthnCredential.count({ where: { userId } }) <= 1) {
      throw new ServiceError("FORBIDDEN", 403, "Last passkey cannot be deleted");
    }
    await tx.webAuthnCredential.delete({ where: { id: credential.id } });
    return credential;
  }, { maxWait: 5_000, timeout: 15_000 });
}
