import { Prisma } from "@prisma/client";

import { getEnv } from "@/backend/config/env";
import { prisma } from "@/backend/database/prisma";
import { recordOperationalEvent } from "@/backend/observability/metrics";
import { securityPolicy } from "@/backend/security/policy";
import {
  decryptKeyringSecret,
  encryptKeyringSecret,
  randomToken,
  sha256,
} from "@/backend/security/crypto";
import { refreshTokenGraceMs } from "@/backend/integrations/sessions/web-session-policy";
import { revokedWebSessionData } from "@/backend/integrations/sessions/web-session-revocation";
import { addMinutes } from "@/backend/integrations/sessions/web-session-token";

const REFRESH_SUCCESSOR_PURPOSE = "web-refresh-successor";

function protectRefreshSuccessor(token: string) {
  return encryptKeyringSecret(
    token,
    getEnv().webRefreshKeyring,
    REFRESH_SUCCESSOR_PURPOSE,
  );
}

function revealRefreshSuccessor(token: string) {
  return decryptKeyringSecret(
    token,
    getEnv().webRefreshKeyring,
    REFRESH_SUCCESSOR_PURPOSE,
  );
}

export async function revokeSessionByRefreshToken(refreshToken: string) {
  const tokenHash = sha256(refreshToken);
  const now = new Date();
  const session = await prisma.webSession.findFirst({
    where: {
      revokedAt: null,
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
    select: { id: true },
  });

  if (!session) {
    return;
  }

  await prisma.webSession.updateMany({
    where: { id: session.id, revokedAt: null },
    data: revokedWebSessionData(now),
  });
}

export async function rotateRefreshTokenFamily(
  refreshToken: string,
  now = new Date(),
) {
  const tokenHash = sha256(refreshToken);
  const accessTokenExpiresAt = addMinutes(
    now,
    securityPolicy.accessSessionTtlMinutes,
  );

  const rotateOnce = () => prisma.$transaction(async (tx) => {
    const locked = await tx.$queryRaw<Array<{ id: string }>>(
      Prisma.sql`
        SELECT session."id"
        FROM "WebSession" AS session
        LEFT JOIN "WebRefreshToken" AS consumed
          ON consumed."sessionId" = session."id"
          AND consumed."tokenHash" = ${tokenHash}
        WHERE session."refreshTokenHash" = ${tokenHash}
          OR consumed."tokenHash" = ${tokenHash}
        FOR UPDATE OF session
      `,
    );

    if (locked.length !== 1) return null;
    const session = await tx.webSession.findUnique({
      where: { id: locked[0].id },
      include: { user: true },
    });

    if (!session || session.revokedAt || session.refreshExpiresAt <= now) return null;

    if (session.refreshTokenHash === tokenHash) {
      const successorToken = randomToken(48);
      await tx.webRefreshToken.create({
        data: {
          sessionId: session.id,
          tokenHash,
          successorTokenEncrypted: protectRefreshSuccessor(successorToken),
          graceExpiresAt: new Date(now.getTime() + refreshTokenGraceMs),
          consumedAt: now,
        },
      });
      const updatedSession = await tx.webSession.update({
        where: { id: session.id },
        data: {
          refreshTokenHash: sha256(successorToken),
          refreshRotatedAt: now,
          accessTokenExpiresAt,
        },
        include: { user: true },
      });

      return {
        status: "ok" as const,
        session: updatedSession,
        successorToken,
        reusedPrevious: false,
      };
    }

    const consumed = await tx.webRefreshToken.findUnique({ where: { tokenHash } });

    if (consumed && consumed.sessionId === session.id && consumed.graceExpiresAt >= now) {
      const revealed = revealRefreshSuccessor(consumed.successorTokenEncrypted);
      const successorToken = revealed.value;
      if (revealed.needsRewrap) {
        await tx.webRefreshToken.updateMany({
          where: {
            id: consumed.id,
            successorTokenEncrypted: consumed.successorTokenEncrypted,
          },
          data: { successorTokenEncrypted: protectRefreshSuccessor(successorToken) },
        });
        recordOperationalEvent("encrypted_refresh_successor_rewrapped");
      }
      const updatedSession = await tx.webSession.update({
        where: { id: session.id },
        data: { accessTokenExpiresAt },
        include: { user: true },
      });
      return {
        status: "ok" as const,
        session: updatedSession,
        successorToken,
        reusedPrevious: true,
      };
    }

    await tx.webSession.update({
      where: { id: session.id },
      data: revokedWebSessionData(now),
    });
    return {
      status: "reuse" as const,
      sessionId: session.id,
      userId: session.userId,
    };
  }, { maxWait: 5_000, timeout: 15_000 });

  // At READ COMMITTED a statement that began before another rotation commits
  // can lose the WHERE recheck after waiting for the row lock. A second
  // transaction observes the newly-created consumed-token row and returns the
  // same successor; it never creates a second branch.
  try {
    return await rotateOnce() ?? await rotateOnce();
  } catch (error) {
    recordOperationalEvent("refresh_token_rotation_failed");
    throw error;
  }
}
