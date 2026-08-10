import { prisma } from "@/backend/database/prisma";
import { ServiceError } from "@/backend/errors/service-error";
import { sha256 } from "@/backend/security/crypto";

export const telegramAccountMergeCookieName = "clean_pay_account_merge";
export const telegramAccountMergeCookieMaxAgeSeconds = 10 * 60;

function normalizedEmail(email: string | null | undefined) {
  return email?.trim().toLowerCase() || null;
}

function maskEmail(email: string | null) {
  const normalized = normalizedEmail(email);
  if (!normalized) return null;
  const [local = "", domain = ""] = normalized.split("@", 2);
  const visible = local.slice(0, Math.min(2, local.length));
  return `${visible}${"*".repeat(Math.max(3, local.length - visible.length))}@${domain}`;
}

export async function getTelegramAccountMergeConfirmation(token: string, userId: string) {
  const confirmation = await prisma.accountMergeConfirmation.findFirst({
    where: { tokenHash: sha256(token), userId },
  });
  if (!confirmation) {
    throw new ServiceError("NOT_FOUND", 404, "Account merge confirmation has expired.");
  }
  const sourceEmail = normalizedEmail(confirmation.sourceEmail);
  const targetEmail = normalizedEmail(confirmation.targetEmail);
  return {
    targetEmail: confirmation.targetEmail,
    sourceEmailMasked: maskEmail(confirmation.sourceEmail),
    emailWillBeReplaced: sourceEmail !== null && sourceEmail !== targetEmail,
    telegramId: confirmation.telegramId,
    status: confirmation.status,
    expiresAt: confirmation.expiresAt,
  };
}
