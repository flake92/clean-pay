import type { PasskeyManagementGateway } from "@/application/auth/ports/passkey-management";
import { prisma } from "@/backend/database/prisma";
import { deleteOwnedPasskey } from "@/backend/integrations/auth/passkey-service";
import { getCurrentSession } from "@/backend/integrations/sessions/web-session-service";
import { auditLog } from "@/backend/observability/audit";

type SessionReader = () => ReturnType<typeof getCurrentSession>;

export function createProductionPasskeyManagementGateway(
  readSession: SessionReader = getCurrentSession,
): PasskeyManagementGateway {
  return {
    async loadActor() {
      const session = await readSession();
      if (!session) return null;
      return {
        userId: session.userId,
        fullAssurance: session.assuranceLevel === "FULL",
        email: session.user.email,
        emailVerified: session.user.emailVerified,
        telegramId: session.user.telegramId,
      };
    },
    async loadOwned(userId) {
      const credentials = await prisma.webAuthnCredential.findMany({
        where: { userId }, orderBy: { createdAt: "asc" },
        select: { id: true, name: true, lastUsedAt: true, createdAt: true },
      });
      return credentials.map((credential) => ({
        id: credential.id,
        name: credential.name,
        createdAt: credential.createdAt.toISOString(),
        lastUsedAt: credential.lastUsedAt?.toISOString() ?? null,
      }));
    },
    async deleteOwned(userId, credentialId) {
      const credential = await deleteOwnedPasskey(userId, credentialId);
      return { externalCredentialId: credential.credentialId };
    },
    auditDeleted: (userId, credentialId) => auditLog({
      action: "passkey_deleted", userId, metadata: { credentialId },
    }),
  };
}
