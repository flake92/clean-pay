import {
  Prisma,
  WebSessionAssuranceLevel,
  WebSessionAuthMethod,
} from "@prisma/client";

import { prisma } from "@/backend/database/prisma";
import { ServiceError } from "@/backend/errors/service-error";
import { revokedWebSessionData } from "@/backend/integrations/sessions/web-session-transitions";
import { sha256 } from "@/backend/security/crypto";

type AccessIdentity = {
  sid: string;
  uid: string;
};

export function findActiveWebSession(
  identity: AccessIdentity,
  now = new Date(),
) {
  return prisma.webSession.findFirst({
    where: {
      id: identity.sid,
      userId: identity.uid,
      revokedAt: null,
      accessTokenExpiresAt: { gt: now },
    },
    include: { user: true },
  });
}

export function findActiveWebSessionIdentity(
  identity: AccessIdentity,
  now = new Date(),
) {
  return prisma.webSession.findFirst({
    where: {
      id: identity.sid,
      userId: identity.uid,
      revokedAt: null,
      accessTokenExpiresAt: { gt: now },
    },
    select: { id: true, userId: true },
  });
}

export function findRefreshSessionCandidate(
  refreshToken: string,
  now = new Date(),
) {
  const tokenHash = sha256(refreshToken);

  return prisma.webSession.findFirst({
    where: {
      revokedAt: null,
      refreshExpiresAt: { gt: now },
      OR: [
        { refreshTokenHash: tokenHash },
        {
          refreshTokenHistory: {
            some: {
              tokenHash,
              graceExpiresAt: { gte: now },
            },
          },
        },
      ],
    },
    select: { id: true, userId: true },
  });
}

export function findWebSessionAccessClaims(userId: string) {
  return prisma.webUser.findUnique({
    where: { id: userId },
    select: { emailVerified: true, telegramId: true },
  });
}

type RemnashopSessionInput = {
  accessTokenEncrypted: string;
  refreshTokenEncrypted: string;
  accessExpiresAt: Date;
  refreshExpiresAt: Date;
};

type CreateWebSessionRecordInput = {
  userId: string;
  refreshToken: string;
  accessTokenExpiresAt: Date;
  refreshExpiresAt: Date;
  userAgent: string | null;
  authMethod?: WebSessionAuthMethod;
  remnashopSession?: RemnashopSessionInput;
};

function webSessionCreateData(input: CreateWebSessionRecordInput) {
  return {
    userId: input.userId,
    refreshTokenHash: sha256(input.refreshToken),
    remnashopAccessTokenEncrypted:
      input.remnashopSession?.accessTokenEncrypted,
    remnashopRefreshTokenEncrypted:
      input.remnashopSession?.refreshTokenEncrypted,
    remnashopAccessExpiresAt: input.remnashopSession?.accessExpiresAt,
    remnashopRefreshExpiresAt: input.remnashopSession?.refreshExpiresAt,
    authMethod: input.authMethod ?? WebSessionAuthMethod.TELEGRAM,
    assuranceLevel: WebSessionAssuranceLevel.FULL,
    userAgent: input.userAgent,
    accessTokenExpiresAt: input.accessTokenExpiresAt,
    refreshExpiresAt: input.refreshExpiresAt,
  };
}

export function createWebSessionRecord(input: CreateWebSessionRecordInput) {
  return prisma.webSession.create({
    data: webSessionCreateData(input),
  });
}

export function createDurableCallbackWebSessionRecord(
  tx: Prisma.TransactionClient,
  input: CreateWebSessionRecordInput,
) {
  return tx.webSession.create({
    data: webSessionCreateData(input),
    include: { user: true },
  });
}

export function findReplayableWebSession(
  sessionId: string,
  userId: string,
  bootstrapRefreshToken: string,
  now: Date,
) {
  return prisma.webSession.findFirst({
    where: {
      id: sessionId,
      userId,
      refreshTokenHash: sha256(bootstrapRefreshToken),
      revokedAt: null,
      accessTokenExpiresAt: { gt: now },
      refreshExpiresAt: { gt: now },
    },
    include: { user: true },
  });
}

export function upgradeWebSessionToFull(
  sessionId: string,
  accessTokenExpiresAt: Date,
) {
  return prisma.webSession.update({
    where: { id: sessionId },
    data: {
      authMethod: WebSessionAuthMethod.PASSKEY,
      assuranceLevel: WebSessionAssuranceLevel.FULL,
      accessTokenExpiresAt,
    },
    include: { user: true },
  });
}

type ReplaceWebSessionRecordInput = {
  sessionId: string;
  userId: string;
  refreshToken: string;
  accessTokenExpiresAt: Date;
  refreshExpiresAt: Date;
  remnashopAccessTokenEncrypted: string;
  remnashopRefreshTokenEncrypted: string;
  remnashopAccessExpiresAt: Date;
  remnashopRefreshExpiresAt: Date;
  now: Date;
};

export function replaceWebSessionAfterPasswordChangeRecord(
  input: ReplaceWebSessionRecordInput,
) {
  const revokedSession = revokedWebSessionData(input.now);

  return prisma.$transaction(async (tx) => {
    const lockedSession = await tx.$queryRaw<Array<{ id: string }>>(
      Prisma.sql`
        SELECT session."id"
        FROM "WebUser" AS app_user
        JOIN "WebSession" AS session
          ON session."userId" = app_user."id"
        WHERE app_user."id" = ${input.userId}
          AND session."id" = ${input.sessionId}
        FOR UPDATE OF app_user, session
      `,
    );

    if (
      lockedSession.length !== 1 ||
      lockedSession[0]?.id !== input.sessionId
    ) {
      throw new ServiceError(
        "UNAUTHORIZED",
        401,
        "Current session is no longer active",
      );
    }

    const currentSession = await tx.webSession.findUnique({
      where: { id: input.sessionId },
      include: { user: true },
    });

    if (
      !currentSession ||
      currentSession.userId !== input.userId ||
      currentSession.revokedAt
    ) {
      throw new ServiceError(
        "UNAUTHORIZED",
        401,
        "Current session is no longer active",
      );
    }

    const revokedSessions = await tx.webSession.updateMany({
      where: { userId: input.userId, revokedAt: null },
      data: revokedSession,
    });

    if (revokedSessions.count < 1) {
      throw new ServiceError(
        "UNAUTHORIZED",
        401,
        "Current session is no longer active",
      );
    }

    const newSession = await tx.webSession.create({
      data: {
        userId: input.userId,
        refreshTokenHash: sha256(input.refreshToken),
        remnashopAccessTokenEncrypted: input.remnashopAccessTokenEncrypted,
        remnashopRefreshTokenEncrypted: input.remnashopRefreshTokenEncrypted,
        remnashopAccessExpiresAt: input.remnashopAccessExpiresAt,
        remnashopRefreshExpiresAt: input.remnashopRefreshExpiresAt,
        authMethod: currentSession.authMethod,
        assuranceLevel: currentSession.assuranceLevel,
        userAgent: currentSession.userAgent,
        ipHash: currentSession.ipHash,
        accessTokenExpiresAt: input.accessTokenExpiresAt,
        refreshExpiresAt: input.refreshExpiresAt,
      },
    });

    return {
      newSession,
      user: currentSession.user,
      revokedSessionCount: revokedSessions.count,
    };
  });
}

export function revokeActiveWebSessionsForUser(userId: string, now: Date) {
  return prisma.webSession.updateMany({
    where: { userId, revokedAt: null },
    data: revokedWebSessionData(now),
  });
}

export function revokeActiveWebSessionIdentity(
  sessionId: string,
  userId: string,
  now: Date,
) {
  return prisma.webSession.updateMany({
    where: {
      id: sessionId,
      userId,
      revokedAt: null,
    },
    data: revokedWebSessionData(now),
  });
}
