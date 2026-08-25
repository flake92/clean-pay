import { describe, expect, it } from "vitest";

import { loadReferralProgram } from "@/application/referral/load-referral-program";
import {
  ReferralProgramAccessError,
  type ReferralProgramAccessReason,
  type ReferralProgramReader,
} from "@/application/referral/ports/referral-program-reader";

const program = {
  enabled: true,
  referralCode: "Friend42",
  webReferralUrl: "https://pay.example.com/invite/Friend42",
  invitedCount: 3,
  invitedWithPaymentCount: 2,
  pointsBalance: 100,
  totalPointsIssued: 150,
  totalDaysIssued: 0,
  rewardType: "POINTS" as const,
  rewardStrategy: "AMOUNT" as const,
  accrualStrategy: "ON_FIRST_PAYMENT" as const,
  maxLevel: 1,
  rewardLevels: [{ level: 1, value: 50 }],
};

function reader(result: typeof program | ReferralProgramAccessReason): ReferralProgramReader {
  return {
    loadProgram: async () => {
      if (typeof result === "string") throw new ReferralProgramAccessError(result);
      return result;
    },
  };
}

describe("loadReferralProgram", () => {
  it("returns a ready typed view model", async () => {
    await expect(loadReferralProgram(reader(program))).resolves.toEqual({
      status: "ready",
      program,
    });
  });

  it.each([
    ["unauthorized", "login"],
    ["provider-session-recovery-required", "recover-session"],
    ["email-required", "verify-email"],
    ["subscription-required", "tariffs"],
  ] as const)("maps %s to the relevant account action", async (reason, action) => {
    await expect(loadReferralProgram(reader(reason))).resolves.toMatchObject({
      status: "error",
      action,
    });
  });

  it("does not leak adapter errors", async () => {
    await expect(loadReferralProgram({
      loadProgram: async () => { throw new Error("private upstream details"); },
    })).resolves.toEqual({
      status: "error",
      message: "Не удалось загрузить реферальную программу. Попробуйте позже.",
    });
  });
});
