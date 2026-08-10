import { prisma } from "@/backend/database/prisma";
import {
  clearWebSessionCookies,
  revokeAllWebSessionsForUser,
} from "@/backend/integrations/sessions/web-session-service";
import { logTechnicalError } from "@/backend/observability/audit";

export function normalizeReplacementIdentityEmail(
  email: string | null | undefined,
) {
  return email?.trim().toLowerCase() || null;
}

async function findReplacementSessionOwnerIds({
  knownOwnerIds,
  remnashopUserId,
  emails,
  telegramId,
}: {
  knownOwnerIds: ReadonlySet<string>;
  remnashopUserId: string | null;
  emails: readonly string[];
  telegramId: string | null;
}) {
  const ownerIds = new Set(knownOwnerIds);
  const lookups: Array<Promise<{ id: string } | null>> = [];

  if (remnashopUserId) {
    lookups.push(
      prisma.webUser.findUnique({
        where: { remnashopUserId },
        select: { id: true },
      }),
    );
  }
  for (const email of new Set(emails.filter(Boolean))) {
    lookups.push(
      prisma.webUser.findUnique({ where: { email }, select: { id: true } }),
    );
  }
  if (telegramId) {
    lookups.push(
      prisma.webUser.findUnique({
        where: { telegramId },
        select: { id: true },
      }),
    );
  }

  const lookupErrors: unknown[] = [];
  for (const result of await Promise.allSettled(lookups)) {
    if (result.status === "fulfilled" && result.value) {
      ownerIds.add(result.value.id);
    } else if (result.status === "rejected") {
      lookupErrors.push(result.reason);
    }
  }
  return { ownerIds: [...ownerIds], lookupErrors };
}

export async function cleanupFailedSessionReplacement({
  originalError,
  knownOwnerIds,
  remnashopUserId,
  emails,
  telegramId,
}: {
  originalError: unknown;
  knownOwnerIds: ReadonlySet<string>;
  remnashopUserId: string | null;
  emails: readonly string[];
  telegramId: string | null;
}) {
  try {
    const { ownerIds, lookupErrors } = await findReplacementSessionOwnerIds({
      knownOwnerIds,
      remnashopUserId,
      emails,
      telegramId,
    });

    for (const lookupError of lookupErrors) {
      logTechnicalError(
        "remnashop_session_replacement_owner_lookup_failed",
        lookupError,
        {
          originalError: originalError instanceof Error
            ? originalError.message
            : String(originalError),
          knownOwnerCount: knownOwnerIds.size,
          hasRemnashopUserId: Boolean(remnashopUserId),
          hasFallbackEmail: emails.length > 0,
          hasTelegramId: Boolean(telegramId),
        },
      );
    }

    for (const ownerId of ownerIds) {
      try {
        await revokeAllWebSessionsForUser(ownerId);
      } catch (cleanupError) {
        logTechnicalError(
          "remnashop_session_replacement_revoke_failed",
          cleanupError,
          {
            originalError: originalError instanceof Error
              ? originalError.message
              : String(originalError),
            ownerId,
            knownOwnerCount: knownOwnerIds.size,
            hasRemnashopUserId: Boolean(remnashopUserId),
            hasFallbackEmail: emails.length > 0,
            hasTelegramId: Boolean(telegramId),
          },
        );
      }
    }
  } catch (cleanupError) {
    logTechnicalError("remnashop_session_replacement_revoke_failed", cleanupError, {
      originalError: originalError instanceof Error
        ? originalError.message
        : String(originalError),
      knownOwnerCount: knownOwnerIds.size,
      hasRemnashopUserId: Boolean(remnashopUserId),
      hasFallbackEmail: emails.length > 0,
      hasTelegramId: Boolean(telegramId),
    });
  }

  try {
    await clearWebSessionCookies();
  } catch (cleanupError) {
    logTechnicalError(
      "remnashop_session_replacement_cookie_clear_failed",
      cleanupError,
      {
        originalError: originalError instanceof Error
          ? originalError.message
          : String(originalError),
      },
    );
  }
}
