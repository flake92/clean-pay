import type {
  ReferralAccrualStrategy,
  ReferralProgram,
  ReferralRewardStrategy,
  ReferralRewardType,
} from "@/application/models/referral";
import {
  ReferralProgramAccessError,
  type ReferralProgramReader,
} from "@/application/referral/ports/referral-program-reader";
import { getEnv } from "@/backend/config/env";
import { ServiceError } from "@/backend/errors/service-error";
import type { ReferralProgramResponse } from "@/backend/integrations/remnashop/contracts";
import {
  getAuthorizedRemnashopTokens,
  remnashopRequest,
} from "@/backend/integrations/remnashop/client";
import {
  canonicalReferralPath,
  normalizeReferralCode,
} from "@/shared/domain/referrals";

type Authorized = Awaited<ReturnType<typeof getAuthorizedRemnashopTokens>>;

const rewardTypes = new Set<ReferralRewardType>(["POINTS", "EXTRA_DAYS"]);
const rewardStrategies = new Set<ReferralRewardStrategy>(["AMOUNT", "PERCENT"]);
const accrualStrategies = new Set<ReferralAccrualStrategy>([
  "ON_FIRST_PAYMENT",
  "ON_EACH_PAYMENT",
]);

function nonNegativeInteger(value: unknown): value is number {
  return Number.isSafeInteger(value) && Number(value) >= 0;
}

function validReferralUrl(value: unknown, publicAppUrl: string, code: string) {
  if (
    typeof value !== "string"
    || value.length > 2_048
    || value.trim() !== value
  ) return null;

  try {
    const actual = new URL(value);
    const expected = new URL(publicAppUrl);
    if (
      actual.protocol !== "http:"
      && actual.protocol !== "https:"
    ) return null;
    if (
      actual.origin !== expected.origin
      || actual.username
      || actual.password
      || actual.pathname !== canonicalReferralPath(code)
      || actual.search
      || actual.hash
    ) {
      return null;
    }
    return actual.toString();
  } catch {
    return null;
  }
}

function parseProgram(value: unknown, publicAppUrl: string): ReferralProgram {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Invalid referral program response");
  }
  const input = value as Record<string, unknown>;
  const referralCode = normalizeReferralCode(input.referral_code);
  const webReferralUrl = referralCode
    ? validReferralUrl(input.web_referral_url, publicAppUrl, referralCode)
    : null;
  const rewardType = input.reward_type;
  const rewardStrategy = input.reward_strategy;
  const accrualStrategy = input.accrual_strategy;
  const maxLevel = input.max_level;
  const rewardLevels = input.reward_levels;

  if (
    typeof input.enabled !== "boolean"
    || !referralCode
    || !webReferralUrl
    || !nonNegativeInteger(input.invited_count)
    || !nonNegativeInteger(input.invited_with_payment_count)
    || !nonNegativeInteger(input.points_balance)
    || !nonNegativeInteger(input.total_points_issued)
    || !nonNegativeInteger(input.total_days_issued)
    || typeof rewardType !== "string"
    || !rewardTypes.has(rewardType as ReferralRewardType)
    || typeof rewardStrategy !== "string"
    || !rewardStrategies.has(rewardStrategy as ReferralRewardStrategy)
    || typeof accrualStrategy !== "string"
    || !accrualStrategies.has(accrualStrategy as ReferralAccrualStrategy)
    || !Number.isSafeInteger(maxLevel)
    || Number(maxLevel) < 1
    || Number(maxLevel) > 2
    || !Array.isArray(rewardLevels)
  ) {
    throw new Error("Invalid referral program response");
  }

  const parsedLevels = rewardLevels.map((entry) => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      throw new Error("Invalid referral reward level");
    }
    const level = (entry as Record<string, unknown>).level;
    const amount = (entry as Record<string, unknown>).value;
    if (
      !Number.isSafeInteger(level)
      || Number(level) < 1
      || Number(level) > Number(maxLevel)
      || !nonNegativeInteger(amount)
    ) {
      throw new Error("Invalid referral reward level");
    }
    return { level: Number(level), value: amount };
  });
  if (
    parsedLevels.length !== Number(maxLevel)
    || new Set(parsedLevels.map(({ level }) => level)).size !== parsedLevels.length
  ) {
    throw new Error("Invalid referral reward levels");
  }
  parsedLevels.sort((left, right) => left.level - right.level);

  return {
    enabled: input.enabled,
    referralCode,
    webReferralUrl,
    invitedCount: input.invited_count,
    invitedWithPaymentCount: input.invited_with_payment_count,
    pointsBalance: input.points_balance,
    totalPointsIssued: input.total_points_issued,
    totalDaysIssued: input.total_days_issued,
    rewardType: rewardType as ReferralRewardType,
    rewardStrategy: rewardStrategy as ReferralRewardStrategy,
    accrualStrategy: accrualStrategy as ReferralAccrualStrategy,
    maxLevel: Number(maxLevel),
    rewardLevels: parsedLevels,
  };
}

function accessReason(error: ServiceError) {
  if (error.status === 401) return "unauthorized" as const;
  if (error.code === "EMAIL_REQUIRED" || error.code === "EMAIL_NOT_VERIFIED") {
    return "email-required" as const;
  }
  if (error.status !== 403) return "unavailable" as const;

  const detail = String(error.debug?.message ?? error.message).toLowerCase();
  if (detail.includes("verified email")) return "email-required" as const;
  if (detail.includes("active subscription")) return "subscription-required" as const;
  if (detail.includes("disabled")) return "disabled" as const;
  return "unavailable" as const;
}

export function createReferralProgramReader(
  authorize: () => Promise<Authorized> = getAuthorizedRemnashopTokens,
  publicAppUrl = getEnv().publicAppUrl,
): ReferralProgramReader {
  return {
    async loadProgram() {
      try {
        const { accessToken } = await authorize();
        const response = await remnashopRequest<ReferralProgramResponse>(
          "/referral/program",
          { accessToken },
        );
        return parseProgram(response, publicAppUrl);
      } catch (error) {
        if (error instanceof ServiceError) {
          throw new ReferralProgramAccessError(accessReason(error));
        }
        if (error instanceof ReferralProgramAccessError) throw error;
        throw new ReferralProgramAccessError("unavailable");
      }
    },
  };
}
