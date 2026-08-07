import type { WebSessionAssuranceLevel, WebSessionAuthMethod } from "@prisma/client";

export interface Session {
  id: string;
  userId: string;
  authMethod: WebSessionAuthMethod;
  assuranceLevel: WebSessionAssuranceLevel;
  accessTokenExpiresAt: Date;
  refreshExpiresAt: Date;
  refreshTokenHash: string;
  revokedAt: Date | null;
  userAgent: string | null;
  ipHash: string | null;
  refreshRotatedAt: Date | null;
  remnashopAccessTokenEncrypted: string | null;
  remnashopRefreshTokenEncrypted: string | null;
  remnashopAccessExpiresAt: Date | null;
  remnashopRefreshExpiresAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface SessionWithUser extends Session {
  user: {
    id: string;
    email: string | null;
    emailVerified: boolean;
    telegramId: string | null;
    telegramUsername: string | null;
    remnashopUserId: string | null;
    fullName: string | null;
    displayName: string | null;
    photoUrl: string | null;
    authPending: boolean;
    pendingRemnashopUserId: string | null;
    pendingRemnashopEmail: string | null;
    lastLoginAt: Date | null;
    createdAt: Date;
    updatedAt: Date;
  };
}

export interface CreateSessionInput {
  userId: string;
  authMethod: WebSessionAuthMethod;
  assuranceLevel: WebSessionAssuranceLevel;
  accessTokenExpiresAt: Date;
  refreshExpiresAt: Date;
  refreshTokenHash: string;
  userAgent?: string;
  remnashopAccessTokenEncrypted?: string;
  remnashopRefreshTokenEncrypted?: string;
  remnashopAccessExpiresAt?: Date;
  remnashopRefreshExpiresAt?: Date;
}

export interface UpdateSessionInput {
  accessTokenExpiresAt?: Date;
  refreshExpiresAt?: Date;
  refreshTokenHash?: string;
  revokedAt?: Date | null;
  remnashopAccessTokenEncrypted?: string;
  remnashopRefreshTokenEncrypted?: string;
  remnashopAccessExpiresAt?: Date;
  remnashopRefreshExpiresAt?: Date;
}

export interface SessionWhereInput {
  id?: string;
  userId?: string;
  revokedAt?: null | { not: null };
}

export interface SessionStore {
  findById(id: string): Promise<Session | null>;
  findByIdWithUser(id: string): Promise<SessionWithUser | null>;
  findActiveSession(id: string, userId: string): Promise<SessionWithUser | null>;
  findByRefreshToken(hash: string): Promise<SessionWithUser | null>;
  create(data: CreateSessionInput): Promise<Session>;
  update(id: string, data: UpdateSessionInput): Promise<void>;
  updateMany(where: SessionWhereInput, data: UpdateSessionInput): Promise<number>;
  revoke(id: string): Promise<void>;
  revokeAllForUser(userId: string, exceptSessionId?: string): Promise<void>;
}
