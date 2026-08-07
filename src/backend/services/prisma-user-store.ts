import { Prisma } from "@prisma/client";

import { prisma } from "@/backend/database/prisma";
import type {
  CreateUserInput,
  UpdateUserInput,
  UpsertUserWhere,
  User,
  UserStore,
  UserWhereInput,
} from "@/backend/services/user-store";

function toUser(row: any): User {
  return {
    id: row.id,
    email: row.email,
    emailVerified: row.emailVerified,
    telegramId: row.telegramId,
    telegramUsername: row.telegramUsername,
    remnashopUserId: row.remnashopUserId,
    fullName: row.fullName,
    displayName: row.displayName,
    photoUrl: row.photoUrl,
    authPending: row.authPending,
    pendingRemnashopUserId: row.pendingRemnashopUserId,
    pendingRemnashopEmail: row.pendingRemnashopEmail,
    lastLoginAt: row.lastLoginAt,
  };
}

function toPrismaWhere(where: UserWhereInput): any {
  if (where.OR) {
    return { OR: where.OR.map(toPrismaWhere) };
  }
  const result: any = {};
  if (where.id) result.id = where.id;
  if (where.email) result.email = where.email;
  if (where.telegramId) result.telegramId = where.telegramId;
  if (where.remnashopUserId) result.remnashopUserId = where.remnashopUserId;
  return result;
}

export const prismaUserStore: UserStore = {
  async findById(id: string): Promise<User | null> {
    const row = await prisma.webUser.findUnique({ where: { id } });
    return row ? toUser(row) : null;
  },

  async findByEmail(email: string): Promise<User | null> {
    const row = await prisma.webUser.findUnique({ where: { email } });
    return row ? toUser(row) : null;
  },

  async findByTelegramId(telegramId: string): Promise<User | null> {
    const row = await prisma.webUser.findUnique({ where: { telegramId } });
    return row ? toUser(row) : null;
  },

  async findByRemnashopId(remnashopUserId: string): Promise<User | null> {
    const row = await prisma.webUser.findUnique({ where: { remnashopUserId } });
    return row ? toUser(row) : null;
  },

  async findMany(where: UserWhereInput): Promise<User[]> {
    const rows = await prisma.webUser.findMany({ where: toPrismaWhere(where) });
    return rows.map(toUser);
  },

  async create(data: CreateUserInput): Promise<User> {
    const row = await prisma.webUser.create({ data: data as any });
    return toUser(row);
  },

  async update(id: string, data: UpdateUserInput): Promise<User> {
    const row = await prisma.webUser.update({ where: { id }, data: data as any });
    return toUser(row);
  },

  async upsert(where: UpsertUserWhere, create: CreateUserInput, update: UpdateUserInput): Promise<User> {
    const row = await prisma.webUser.upsert({
      where: where as any,
      create: create as any,
      update: update as any,
    });
    return toUser(row);
  },

  async deleteMany(ids: string[]): Promise<number> {
    const result = await prisma.webUser.deleteMany({ where: { id: { in: ids } } });
    return result.count;
  },
};
