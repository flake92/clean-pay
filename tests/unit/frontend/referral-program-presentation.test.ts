import { describe, expect, it } from "vitest";

import type { ReferralProgram } from "@/application/models/referral";
import {
  referralAccrualDescription,
  referralErrorAction,
  referralRewardDescription,
  referralUsesPoints,
} from "@/frontend/components/referral-program-presentation";

const program: ReferralProgram = {
  enabled: true,
  referralCode: "Friend42",
  webReferralUrl: "https://pay.example.com/invite/Friend42",
  invitedCount: 5,
  invitedWithPaymentCount: 3,
  pointsBalance: 75,
  totalPointsIssued: 100,
  totalDaysIssued: 0,
  rewardType: "POINTS",
  rewardStrategy: "AMOUNT",
  accrualStrategy: "ON_FIRST_PAYMENT",
  maxLevel: 2,
  rewardLevels: [],
};

describe("referral program pure presentation", () => {
  it("preserves accrual and reward-type selectors", () => {
    expect(referralAccrualDescription(program)).toContain(
      "после первого успешного платежа",
    );
    expect(referralAccrualDescription({
      ...program,
      accrualStrategy: "ON_EACH_PAYMENT",
    })).toContain("после каждого успешного платежа или продления");
    expect(referralUsesPoints(program)).toBe(true);
    expect(referralUsesPoints({ ...program, rewardType: "EXTRA_DAYS" }))
      .toBe(false);
  });

  it.each([
    [1, "1 балл"],
    [2, "2 балла"],
    [5, "5 баллов"],
    [11, "11 баллов"],
    [21, "21 балл"],
  ])("preserves Russian point pluralization for %i", (value, expected) => {
    expect(referralRewardDescription(program, { level: 1, value }))
      .toBe(`За приглашённого вами пользователя: ${expected}.`);
  });

  it("preserves second-level, percent and extra-day copy", () => {
    expect(referralRewardDescription({
      ...program,
      rewardStrategy: "PERCENT",
    }, { level: 2, value: 10 })).toBe(
      "За пользователя, приглашённого вашим другом: 10% от стоимости платежа.",
    );
    expect(referralRewardDescription({
      ...program,
      rewardType: "EXTRA_DAYS",
    }, { level: 1, value: 2 })).toBe(
      "За приглашённого вами пользователя: 2 дополнительных дня.",
    );
    expect(referralRewardDescription({
      ...program,
      rewardStrategy: "PERCENT",
      rewardType: "EXTRA_DAYS",
    }, { level: 1, value: 15 })).toContain("15% от оплаченного срока");
  });

  it("preserves every error action destination and the absent-action branch", () => {
    const model = { status: "error" as const, message: "failure" };
    expect(referralErrorAction({ ...model, action: "recover-session" }))
      .toEqual({ href: "/auth/session/recover?return_to=%2Freferral", label: "Продолжить" });
    expect(referralErrorAction({ ...model, action: "login" }))
      .toEqual({ href: "/auth/session/refresh?return_to=%2Freferral", label: "Войти" });
    expect(referralErrorAction({ ...model, action: "verify-email" }))
      .toEqual({ href: "/verify-email", label: "Подтвердить e-mail" });
    expect(referralErrorAction({ ...model, action: "tariffs" }))
      .toEqual({ href: "/tariffs", label: "Выбрать тариф" });
    expect(referralErrorAction(model)).toBeNull();
  });
});
