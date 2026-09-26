export type ProviderAccountIdentity = {
  accountId: string;
  email: string | null;
  emailVerified: boolean;
  pendingEmail: string | null;
  telegramId: string | null;
};

export type ExpectedProviderAccountIdentity = ProviderAccountIdentity;

function normalizedEmail(value: string | null | undefined) {
  return value?.trim().toLowerCase() || null;
}

export function providerAccountIdentityMismatch(
  actual: ProviderAccountIdentity,
  expected: ExpectedProviderAccountIdentity,
) {
  if (actual.accountId !== expected.accountId) return "account_id";
  if (normalizedEmail(actual.email) !== normalizedEmail(expected.email)) return "email";
  if (actual.emailVerified !== expected.emailVerified) return "email_verified";
  if (normalizedEmail(actual.pendingEmail) !== normalizedEmail(expected.pendingEmail)) return "pending_email";
  if (actual.telegramId !== expected.telegramId) return "telegram_id";
  return null;
}
