export const REFERRAL_CODE_MIN_LENGTH = 3;
export const REFERRAL_CODE_MAX_LENGTH = 64;
export const REFERRAL_ATTRIBUTION_COOKIE_NAME = "clean_pay_referral";

const REFERRAL_CODE_PATTERN = /^[A-Za-z0-9]+$/;

export function normalizeReferralCode(value: unknown): string | null {
  if (typeof value !== "string") return null;

  if (
    value.length < REFERRAL_CODE_MIN_LENGTH
    || value.length > REFERRAL_CODE_MAX_LENGTH
    || !REFERRAL_CODE_PATTERN.test(value)
  ) {
    return null;
  }

  return value;
}

export function canonicalReferralPath(code: string) {
  const normalized = normalizeReferralCode(code);
  if (!normalized) throw new Error("Invalid referral code");

  return `/invite/${encodeURIComponent(normalized)}`;
}
