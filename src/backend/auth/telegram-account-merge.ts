import { AccountMergeConfirmationStatus } from "@prisma/client";

import { prisma } from "@/backend/database/prisma";
import {
  getRemnashopMe,
  getRemnashopUserIdFromAccessToken,
  remnashopAuthTelegramIdentity,
  remnashopMergeUsers,
  remnashopRequest,
} from "@/backend/integrations/remnashop/client";
import { BffError } from "@/backend/integrations/remnashop/errors";
import { linkCurrentUserToRemnashopAuth } from "@/backend/integrations/remnashop/session";
import { assertRateLimit } from "@/backend/limits/rate-limit";
import { auditLog } from "@/backend/observability/audit";
import { randomToken, sha256 } from "@/backend/security/crypto";
import {
  getCurrentSession,
  refreshCurrentAccessCookie,
} from "@/backend/sessions/web-session";
import type { CurrentSubscriptionResponse } from "@/shared/remnashop/types";

const confirmationTtlMs = 10 * 60 * 1000;
const processingLeaseMs = 2 * 60 * 1000;
export const telegramAccountMergeCookieName = "clean_pay_account_merge";
export const telegramAccountMergeCookieMaxAgeSeconds = confirmationTtlMs / 1000;
const mergeReason =
  "Clean Pay confirmed account merge: keep target e-mail and selected source Telegram";

type TelegramAuthResult = {
  data: { expires_at: string; refresh_expires_at: string };
  cookies: { accessToken: string; refreshToken: string };
};

function normalizedEmail(email: string | null | undefined) {
  return email?.trim().toLowerCase() || null;
}

function emailWillBeReplaced(
  sourceEmail: string | null | undefined,
  targetEmail: string | null | undefined,
) {
  const source = normalizedEmail(sourceEmail);
  return source !== null && source !== normalizedEmail(targetEmail);
}

function assertNoPendingEmailChange(
  profile: Awaited<ReturnType<typeof getRemnashopMe>>,
) {
  if (normalizedEmail(profile.pending_email)) {
    throw mergeRequired(
      "Сначала завершите или отмените начатую смену e-mail, затем повторите объединение аккаунтов.",
    );
  }
}

function maskEmail(email: string | null) {
  if (!email) {
    return null;
  }

  const [local = "", domain = ""] = email.split("@", 2);
  const visible = local.slice(0, Math.min(2, local.length));
  return `${visible}${"*".repeat(Math.max(3, local.length - visible.length))}@${domain}`;
}

function hasSubscriptionConflict(conflicts: string[]) {
  return conflicts.some((conflict) =>
    conflict.toLowerCase().includes("both users have current subscriptions"),
  );
}

function isTransientPaymentConflict(conflict: string) {
  const normalized = conflict.toLowerCase();
  return normalized.includes("active payment operations") ||
    normalized.includes("payment fulfillment in progress");
}

function mergeRequired(message: string, conflicts?: string[]) {
  return new BffError("ACCOUNT_MERGE_REQUIRED", 409, message, {
    message,
    cause: conflicts,
  });
}

async function mergePreflight({
  sourceRemnashopUserId,
  targetRemnashopUserId,
  allowTransientPaymentWork = false,
}: {
  sourceRemnashopUserId: string;
  targetRemnashopUserId: string;
  allowTransientPaymentWork?: boolean;
}) {
  const result = await remnashopMergeUsers({
    sourceUserId: sourceRemnashopUserId,
    targetUserId: targetRemnashopUserId,
    reason: `${mergeReason} (dry run)`,
    dryRun: true,
    emailResolution: "KEEP_TARGET",
    telegramResolution: "KEEP_SOURCE",
    paymentResolution: "REKEY_SOURCE",
  });

  if (result.conflicts.length > 0) {
    if (hasSubscriptionConflict(result.conflicts)) {
      throw new BffError(
        "ACCOUNT_MERGE_SUBSCRIPTIONS_CONFLICT",
        409,
        "У обеих учётных записей есть активные подписки. Объединение остановлено; обратитесь в службу поддержки.",
        { cause: result.conflicts },
      );
    }

    const unexpected = result.conflicts.filter(
      (conflict) => !isTransientPaymentConflict(conflict),
    );
    if (unexpected.length > 0) {
      throw mergeRequired(
        "Данные учётных записей изменились. Начните привязку заново.",
        unexpected,
      );
    }

    if (!allowTransientPaymentWork) {
      throw new BffError(
        "ACCOUNT_MERGE_IN_PROGRESS",
        409,
        "Платёж ещё обрабатывается. Дождитесь завершения и повторите объединение — данные не изменены.",
        { cause: result.conflicts },
      );
    }
  }

  return result;
}

function assertMergePreflightTarget({
  result,
  sourceRemnashopUserId,
  targetRemnashopUserId,
  targetEmail,
  selectedTelegramId,
}: {
  result: Awaited<ReturnType<typeof mergePreflight>>;
  sourceRemnashopUserId: string;
  targetRemnashopUserId: string;
  targetEmail: string;
  selectedTelegramId: string;
}) {
  const targetTelegramId = result.target.telegram_id === null
    ? null
    : String(result.target.telegram_id);
  if (
    result.dry_run !== true ||
    String(result.source_user_id) !== sourceRemnashopUserId ||
    String(result.target_user_id) !== targetRemnashopUserId ||
    String(result.target.id) !== targetRemnashopUserId ||
    normalizedEmail(result.target.email) !== normalizedEmail(targetEmail) ||
    !result.target.is_email_verified ||
    (targetTelegramId !== null && targetTelegramId !== selectedTelegramId) ||
    result.requires_relogin !== true
  ) {
    throw mergeRequired(
      "Remnashop target ownership changed. Start the account link again.",
    );
  }
}

export async function stageTelegramAccountMerge({
  userId,
  telegramId,
  telegramUsername,
  telegramAuth,
}: {
  userId: string;
  telegramId: string;
  telegramUsername: string | null;
  telegramAuth: TelegramAuthResult;
}) {
  const [targetUser, sourceProfile] = await Promise.all([
    prisma.webUser.findUnique({ where: { id: userId } }),
    getRemnashopMe(telegramAuth.cookies.accessToken),
  ]);

  if (
    !targetUser ||
    !targetUser.email ||
    !targetUser.emailVerified ||
    !targetUser.remnashopUserId
  ) {
    throw mergeRequired(
      "Текущая учётная запись должна иметь подтверждённый e-mail и связь с Remnashop.",
    );
  }

  if (String(sourceProfile.telegram_id) !== telegramId) {
    throw mergeRequired("Подтверждённый Telegram не совпал с учётной записью Remnashop.");
  }

  const sourceRemnashopUserId = getRemnashopUserIdFromAccessToken(
    telegramAuth.cookies.accessToken,
  );
  const targetRemnashopUserId = targetUser.remnashopUserId;

  if (sourceRemnashopUserId === targetRemnashopUserId) {
    return { required: false as const };
  }

  if (targetUser.telegramId && targetUser.telegramId !== telegramId) {
    throw mergeRequired(
      "В текущей учётной записи уже привязан другой Telegram. Автоматическая замена остановлена; обратитесь в поддержку.",
    );
  }

  assertNoPendingEmailChange(sourceProfile);

  const preflight = await mergePreflight({
    sourceRemnashopUserId,
    targetRemnashopUserId,
    allowTransientPaymentWork: true,
  });
  assertMergePreflightTarget({
    result: preflight,
    sourceRemnashopUserId,
    targetRemnashopUserId,
    targetEmail: targetUser.email,
    selectedTelegramId: telegramId,
  });

  const token = randomToken();
  const now = new Date();
  await prisma.$transaction(async (tx) => {
    await tx.$queryRaw<Array<{ id: string }>>`
      SELECT "id"
      FROM "WebUser"
      WHERE "id" = ${userId}
      FOR UPDATE
    `;
    const activeProcessing = await tx.$queryRaw<Array<{ id: string }>>`
      SELECT "id"
      FROM "AccountMergeConfirmation"
      WHERE "userId" = ${userId}
        AND "status" = 'PROCESSING'
        AND "leaseExpiresAt" > clock_timestamp()
      LIMIT 1
      FOR UPDATE
    `;

    if (activeProcessing.length > 0) {
      throw new BffError(
        "CONFLICT",
        409,
        "Another account merge is already being processed.",
      );
    }

    await tx.accountMergeConfirmation.updateMany({
      where: {
        userId,
        OR: [
          { status: AccountMergeConfirmationStatus.PENDING },
          {
            status: AccountMergeConfirmationStatus.PROCESSING,
            leaseExpiresAt: { lte: now },
          },
        ],
      },
      data: {
        status: AccountMergeConfirmationStatus.FAILED,
        lastErrorCode: "SUPERSEDED",
      },
    });
    await tx.accountMergeConfirmation.create({
      data: {
        userId,
        tokenHash: sha256(token),
        telegramId,
        telegramUsername,
        sourceEmail: normalizedEmail(sourceProfile.email),
        targetEmail: normalizedEmail(targetUser.email)!,
        sourceRemnashopUserId,
        targetRemnashopUserId,
        expiresAt: new Date(now.getTime() + confirmationTtlMs),
      },
    });
  });

  return {
    required: true as const,
    token,
    sourceEmailMasked: maskEmail(normalizedEmail(sourceProfile.email)),
    targetEmail: normalizedEmail(targetUser.email)!,
    emailWillBeReplaced: emailWillBeReplaced(
      sourceProfile.email,
      targetUser.email,
    ),
  };
}

async function confirmationForCurrentSession(token: string) {
  const session = await getCurrentSession();

  if (!session) {
    throw new BffError("UNAUTHORIZED", 401, "Login is required.");
  }

  const confirmation = await prisma.accountMergeConfirmation.findFirst({
    where: {
      tokenHash: sha256(token),
      userId: session.userId,
    },
  });

  if (!confirmation) {
    throw new BffError("NOT_FOUND", 404, "Account merge confirmation was not found.");
  }

  return { confirmation, session };
}

export async function getTelegramAccountMergeConfirmation(token: string) {
  const { confirmation } = await confirmationForCurrentSession(token);

  if (
    confirmation.expiresAt <= new Date() ||
    confirmation.status === AccountMergeConfirmationStatus.FAILED
  ) {
    throw new BffError("NOT_FOUND", 404, "Account merge confirmation has expired.");
  }

  return {
    targetEmail: confirmation.targetEmail,
    sourceEmailMasked: maskEmail(confirmation.sourceEmail),
    emailWillBeReplaced: emailWillBeReplaced(
      confirmation.sourceEmail,
      confirmation.targetEmail,
    ),
    telegramId: confirmation.telegramId,
    status: confirmation.status,
  };
}

export async function cancelTelegramAccountMerge(token: string) {
  const { confirmation, session } = await confirmationForCurrentSession(token);
  const cancelled = await prisma.accountMergeConfirmation.updateMany({
    where: {
      id: confirmation.id,
      userId: session.userId,
      status: AccountMergeConfirmationStatus.PENDING,
    },
    data: {
      status: AccountMergeConfirmationStatus.FAILED,
      lastErrorCode: "USER_CANCELLED",
    },
  });

  if (cancelled.count !== 1) {
    throw new BffError(
      "CONFLICT",
      409,
      "Account merge can no longer be cancelled.",
    );
  }

  return { cancelled: true };
}

export async function confirmTelegramAccountMerge(token: string) {
  const { confirmation, session } = await confirmationForCurrentSession(token);
  await assertRateLimit({
    action: "telegram_account_merge_confirm",
    tgId: confirmation.telegramId,
    limit: 5,
    windowSeconds: 15 * 60,
  });
  const now = new Date();

  await auditLog({
    action: "telegram_account_merge_attempted",
    userId: session.userId,
    metadata: { confirmationId: confirmation.id },
  });

  if (confirmation.status === AccountMergeConfirmationStatus.COMPLETED) {
    await auditLog({
      action: "telegram_account_merge_succeeded",
      userId: session.userId,
      metadata: { confirmationId: confirmation.id, replay: true },
    });
    return { merged: true, userId: session.userId };
  }

  const claimed = await prisma.$transaction(async (tx) => {
    await tx.$queryRaw<Array<{ id: string }>>`
      SELECT "id"
      FROM "WebUser"
      WHERE "id" = ${session.userId}
      FOR UPDATE
    `;

    return tx.accountMergeConfirmation.updateMany({
      where: {
        id: confirmation.id,
        userId: session.userId,
        expiresAt: { gt: now },
        OR: [
          { status: AccountMergeConfirmationStatus.PENDING },
          {
            status: AccountMergeConfirmationStatus.PROCESSING,
            leaseExpiresAt: { lte: now },
          },
        ],
      },
      data: {
        status: AccountMergeConfirmationStatus.PROCESSING,
        leaseExpiresAt: new Date(now.getTime() + processingLeaseMs),
        attemptCount: { increment: 1 },
        lastErrorCode: null,
      },
    });
  });

  if (claimed.count !== 1) {
    await auditLog({
      action: "telegram_account_merge_failed",
      userId: session.userId,
      severity: "WARN",
      metadata: {
        confirmationId: confirmation.id,
        errorCode: "CONFLICT",
        retryable: true,
      },
    });
    throw new BffError("CONFLICT", 409, "Account merge is already being processed.");
  }

  try {
    const current = await prisma.webUser.findUnique({ where: { id: session.userId } });
    if (
      !current ||
      !current.emailVerified ||
      normalizedEmail(current.email) !== confirmation.targetEmail ||
      current.remnashopUserId !== confirmation.targetRemnashopUserId ||
      (
        current.telegramId !== null &&
        current.telegramId !== confirmation.telegramId
      )
    ) {
      throw mergeRequired("Владелец текущей учётной записи изменился. Начните привязку заново.");
    }

    let telegramAuth = await remnashopAuthTelegramIdentity({
      telegramId: confirmation.telegramId,
      telegramUsername: confirmation.telegramUsername,
    });
    const authenticatedUserId = getRemnashopUserIdFromAccessToken(
      telegramAuth.cookies.accessToken,
    );

    if (
      authenticatedUserId !== confirmation.sourceRemnashopUserId &&
      authenticatedUserId !== confirmation.targetRemnashopUserId
    ) {
      throw mergeRequired("Владелец Telegram изменился. Начните привязку заново.");
    }

    // If the upstream merge committed but its response was lost, Telegram
    // already authenticates as the target. Do not address the deleted source
    // again; prove the final upstream owner and finish the local transaction.
    let expectedHasSubscription: boolean | null = null;
    if (authenticatedUserId === confirmation.sourceRemnashopUserId) {
      const sourceProfile = await getRemnashopMe(
        telegramAuth.cookies.accessToken,
      );
      if (
        String(sourceProfile.telegram_id) !== confirmation.telegramId ||
        normalizedEmail(sourceProfile.email) !== confirmation.sourceEmail
      ) {
        throw mergeRequired(
          "Данные Telegram-учётной записи изменились. Начните объединение заново.",
        );
      }
      assertNoPendingEmailChange(sourceProfile);

      const preflight = await mergePreflight({
        sourceRemnashopUserId: confirmation.sourceRemnashopUserId,
        targetRemnashopUserId: confirmation.targetRemnashopUserId,
      });
      assertMergePreflightTarget({
        result: preflight,
        sourceRemnashopUserId: confirmation.sourceRemnashopUserId,
        targetRemnashopUserId: confirmation.targetRemnashopUserId,
        targetEmail: confirmation.targetEmail,
        selectedTelegramId: confirmation.telegramId,
      });
      const merged = await remnashopMergeUsers({
        sourceUserId: confirmation.sourceRemnashopUserId,
        targetUserId: confirmation.targetRemnashopUserId,
        reason: mergeReason,
        dryRun: false,
        emailResolution: "KEEP_TARGET",
        telegramResolution: "KEEP_SOURCE",
        paymentResolution: "REKEY_SOURCE",
      });
      expectedHasSubscription = Boolean(merged.target.current_subscription_id);
    }

    telegramAuth = await remnashopAuthTelegramIdentity({
      telegramId: confirmation.telegramId,
      telegramUsername: confirmation.telegramUsername,
    });
    const finalUserId = getRemnashopUserIdFromAccessToken(
      telegramAuth.cookies.accessToken,
    );
    const finalProfile = await getRemnashopMe(telegramAuth.cookies.accessToken);
    const finalSubscription = await remnashopRequest<CurrentSubscriptionResponse | null>(
      "/subscription/current",
      { accessToken: telegramAuth.cookies.accessToken },
    );

    if (
      finalUserId !== confirmation.targetRemnashopUserId ||
      String(finalProfile.telegram_id) !== confirmation.telegramId ||
      normalizedEmail(finalProfile.email) !== confirmation.targetEmail ||
      !finalProfile.is_email_verified ||
      normalizedEmail(finalProfile.pending_email) !== null ||
      (expectedHasSubscription !== null &&
        expectedHasSubscription !== Boolean(finalSubscription))
    ) {
      throw mergeRequired("Remnashop вернул несогласованный результат объединения.");
    }

    const linked = await linkCurrentUserToRemnashopAuth({
      accessToken: telegramAuth.cookies.accessToken,
      refreshToken: telegramAuth.cookies.refreshToken,
      auth: telegramAuth.data,
      invalidateSiblingRemnashopTokens: true,
    });

    const completed = await prisma.accountMergeConfirmation.updateMany({
      where: {
        id: confirmation.id,
        userId: session.userId,
        status: AccountMergeConfirmationStatus.PROCESSING,
      },
      data: {
        status: AccountMergeConfirmationStatus.COMPLETED,
        completedAt: new Date(),
        leaseExpiresAt: null,
        lastErrorCode: null,
      },
    });
    if (completed.count !== 1) {
      throw new BffError(
        "INTERNAL_ERROR",
        500,
        "Account merge confirmation changed before completion.",
      );
    }
    await refreshCurrentAccessCookie();
    await auditLog({
      action: "telegram_account_merge_succeeded",
      userId: linked.user.id,
      metadata: { confirmationId: confirmation.id },
    });

    return { merged: true, userId: linked.user.id };
  } catch (error) {
    const terminal = error instanceof BffError && (
      error.code === "ACCOUNT_MERGE_REQUIRED" ||
      error.code === "ACCOUNT_MERGE_SUBSCRIPTIONS_CONFLICT"
    );
    await prisma.accountMergeConfirmation.updateMany({
      where: {
        id: confirmation.id,
        userId: session.userId,
        status: AccountMergeConfirmationStatus.PROCESSING,
      },
      data: {
        status: terminal
          ? AccountMergeConfirmationStatus.FAILED
          : AccountMergeConfirmationStatus.PENDING,
        leaseExpiresAt: null,
        lastErrorCode: error instanceof BffError ? error.code : "INTERNAL_ERROR",
      },
    });
    await auditLog({
      action: "telegram_account_merge_failed",
      userId: session.userId,
      severity: "WARN",
      metadata: {
        confirmationId: confirmation.id,
        errorCode: error instanceof BffError ? error.code : "INTERNAL_ERROR",
        retryable: !terminal,
      },
    });
    throw error;
  }
}
