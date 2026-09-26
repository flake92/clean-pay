export type ReferralRewardType = "POINTS" | "EXTRA_DAYS";
export type ReferralRewardStrategy = "AMOUNT" | "PERCENT";
export type ReferralAccrualStrategy = "ON_FIRST_PAYMENT" | "ON_EACH_PAYMENT";

export type ReferralRewardLevel = {
  level: number;
  value: number;
};

export type ReferralProgram = {
  enabled: boolean;
  referralCode: string;
  webReferralUrl: string;
  invitedCount: number;
  invitedWithPaymentCount: number;
  pointsBalance: number;
  totalPointsIssued: number;
  totalDaysIssued: number;
  rewardType: ReferralRewardType;
  rewardStrategy: ReferralRewardStrategy;
  accrualStrategy: ReferralAccrualStrategy;
  maxLevel: number;
  rewardLevels: ReferralRewardLevel[];
};

export type ReferralProgramViewModel =
  | { status: "ready"; program: ReferralProgram }
  | {
      status: "error";
      message: string;
      action?: "login" | "recover-session" | "verify-email" | "tariffs";
    };
