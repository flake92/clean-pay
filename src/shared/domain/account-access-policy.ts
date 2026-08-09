export type AccountAccessIdentity = {
  email?: string | null;
  emailVerified: boolean;
  telegramId: string | null;
};

export function accountAccessIssue(
  identity: AccountAccessIdentity,
  options: { requireVerifiedEmail?: boolean } = {},
): "EMAIL_REQUIRED" | "EMAIL_NOT_VERIFIED" | null {
  if (options.requireVerifiedEmail && !identity.email) return "EMAIL_REQUIRED";
  if (options.requireVerifiedEmail && !identity.emailVerified) return "EMAIL_NOT_VERIFIED";
  if (!identity.emailVerified && !identity.telegramId) return "EMAIL_NOT_VERIFIED";
  return null;
}
