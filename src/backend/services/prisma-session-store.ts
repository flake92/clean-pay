import { prisma } from "@/backend/database/prisma";
import type {
  CreateSessionInput,
  Session,
  SessionStore,
  SessionWhereInput,
  SessionWithUser,
  UpdateSessionInput,
} from "@/backend/services/session-store";

function toSession(row: any): Session {
  return {
    id: row.id,
    userId: row.userId,
    authMethod: row.authMethod,
    assuranceLevel: row.assuranceLevel,
    accessTokenExpiresAt: row.accessTokenExpiresAt,
    refreshExpiresAt: row.refreshExpiresAt,
    refreshTokenHash: row.refreshTokenHash,
    revokedAt: row.revokedAt,
    userAgent: row.userAgent,
    remnashopAccessTokenEncrypted: row.remnashopAccessTokenEncrypted,
    remnashopRefreshTokenEncrypted: row.remnashopRefreshTokenEncrypted,
    remnashopAccessExpiresAt: row.remnashopAccessExpiresAt,
    remnashopRefreshExpiresAt: row.remnashopRefreshExpiresAt,
  };
}

function toSessionWithUser(row: any): SessionWithUser {
  return {
    ...toSession(row),
    user: {
      id: row.user.id,
      email: row.user.email,
      emailVerified: row.user.emailVerified,
      telegramId: row.user.telegramId,
    },
  };
}

function toPrismaWhere(where: SessionWhereInput): any {
  const result: any = {};
  if (where.id) result.id = where.id;
  if (where.userId) result.userId = where.userId;
  if (where.revokedAt === null) result.revokedAt = null;
  if (where.revokedAt && typeof where.revokedAt === "object" && where.revokedAt.not !== undefined) {
    result.revokedAt = { not: where.revokedAt.not };
  }
  return result;
}

export const prismaSessionStore: SessionStore = {
  async findById(id: string): Promise<Session | null> {
    const row = await prisma.webSession.findUnique({ where: { id } });
    return row ? toSession(row) : null;
  },

  async findByIdWithUser(id: string): Promise<SessionWithUser | null> {
    const row = await prisma.webSession.findUnique({ where: { id }, include: { user: true } });
    return row ? toSessionWithUser(row) : null;
  },

  async findByRefreshToken(hash: string): Promise<SessionWithUser | null> {
    const row = await prisma.webSession.findFirst({
      where: { refreshTokenHash: hash, revokedAt: null },
      include: { user: true },
    });
    return row ? toSessionWithUser(row) : null;
  },

  async create(data: CreateSessionInput): Promise<Session> {
    const row = await prisma.webSession.create({ data: data as any });
    return toSession(row);
  },

  async update(id: string, data: UpdateSessionInput): Promise<void> {
    await prisma.webSession.update({ where: { id }, data: data as any });
  },

  async updateMany(where: SessionWhereInput, data: UpdateSessionInput): Promise<number> {
    const result = await prisma.webSession.updateMany({ where: toPrismaWhere(where), data: data as any });
    return result.count;
  },

  async revoke(id: string): Promise<void> {
    await prisma.webSession.update({
      where: { id },
      data: { revokedAt: new Date() },
    });
  },

  async revokeAllForUser(userId: string, exceptSessionId?: string): Promise<void> {
    const where: any = { userId, revokedAt: null };
    if (exceptSessionId) {
      where.id = { not: exceptSessionId };
    }
    await prisma.webSession.updateMany({
      where,
      data: { revokedAt: new Date() },
    });
  },
};
