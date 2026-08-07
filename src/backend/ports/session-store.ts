import type { WebSessionAuthMethod, WebSessionAssuranceLevel } from "@prisma/client";

export type SessionWhereInput = {
  id?: string;
  userId?: string;
  revokedAt?: null | { not: null };
};

export type CreateSessionInput = {
  userId: string;
  authMethod: WebSessionAuthMethod;
  assuranceLevel: WebSessionAssuranceLevel;
  userAgent?: string | null;
  accessTokenExpiresAt: Date;
  refreshExpiresAt: Date;
  refreshTokenHash: string;
  remnashopAccessTokenEncrypted?: string | null;
  remnashopRefreshTokenEncrypted?: string | null;
  remnashopAccessExpiresAt?: Date | null;
  remnashopRefreshExpiresAt?: Date | null;
};

export type UpdateSessionInput = {
  accessTokenExpiresAt?: Date;
  refreshExpiresAt?: Date;
  refreshTokenHash?: string;
  remnashopAccessTokenEncrypted?: string | null;
  remnashopRefreshTokenEncrypted?: string | null;
  remnashopAccessExpiresAt?: Date | null;
  remnashopRefreshExpiresAt?: Date | null;
  revokedAt?: Date | null;
  authMethod?: WebSessionAuthMethod;
  assuranceLevel?: WebSessionAssuranceLevel;
};

export type Session = {
  id: string;
  userId: string;
  authMethod: WebSessionAuthMethod;
  assuranceLevel: WebSessionAssuranceLevel;
  accessTokenExpiresAt: Date;
  refreshExpiresAt: Date;
  refreshTokenHash: string;
  revokedAt: Date | null;
  userAgent: string | null;
  remnashopAccessTokenEncrypted: string | null;
  remnashopRefreshTokenEncrypted: string | null;
  remnashopAccessExpiresAt: Date | null;
  remnashopRefreshExpiresAt: Date | null;
};

export type SessionWithUser = Session & {
  user: {
    id: string;
    email: string | null;
    emailVerified: boolean;
    telegramId: string | null;
  };
};

export interface SessionStore {
  findById(id: string): Promise<Session | null>;
  findByIdWithUser(id: string): Promise<SessionWithUser | null>;
  findByRefreshToken(hash: string): Promise<SessionWithUser | null>;
  create(data: CreateSessionInput): Promise<Session>;
  update(id: string, data: UpdateSessionInput): Promise<void>;
  updateMany(where: SessionWhereInput, data: UpdateSessionInput): Promise<number>;
  revoke(id: string): Promise<void>;
  revokeAllForUser(userId: string, exceptSessionId?: string): Promise<void>;
}
