import type {
  ReferralProgram,
  ReferralProgramViewModel,
  ReferralRewardLevel,
} from "@/application/models/referral";
import {
  providerSessionRecoveryPath,
  sessionRefreshPath,
} from "@/shared/auth/session-navigation";

function russianPlural(value: number, one: string, few: string, many: string) {
  const modulo100 = Math.abs(value) % 100;
  const modulo10 = modulo100 % 10;
  if (modulo100 > 10 && modulo100 < 20) return many;
  if (modulo10 === 1) return one;
  if (modulo10 >= 2 && modulo10 <= 4) return few;
  return many;
}

export function referralAccrualDescription(program: ReferralProgram) {
  return program.accrualStrategy === "ON_FIRST_PAYMENT"
    ? "Награда начисляется после первого успешного платежа приглашённого пользователя."
    : "Награда начисляется после каждого успешного платежа или продления приглашённого пользователя.";
}

export function referralRewardDescription(
  program: ReferralProgram,
  reward: ReferralRewardLevel,
) {
  const audience = reward.level === 1
    ? "За приглашённого вами пользователя"
    : "За пользователя, приглашённого вашим другом";
  if (program.rewardStrategy === "PERCENT") {
    const basis = program.rewardType === "POINTS"
      ? "стоимости платежа"
      : "оплаченного срока";
    return `${audience}: ${reward.value}% от ${basis}.`;
  }
  if (program.rewardType === "POINTS") {
    const unit = russianPlural(reward.value, "балл", "балла", "баллов");
    return `${audience}: ${reward.value} ${unit}.`;
  }
  const unit = russianPlural(
    reward.value,
    "дополнительный день",
    "дополнительных дня",
    "дополнительных дней",
  );
  return `${audience}: ${reward.value} ${unit}.`;
}

export function referralErrorAction(
  model: Extract<ReferralProgramViewModel, { status: "error" }>,
) {
  return model.action === "recover-session"
    ? { href: providerSessionRecoveryPath("/referral"), label: "Продолжить" }
    : model.action === "login"
    ? { href: sessionRefreshPath("/referral"), label: "Войти" }
    : model.action === "verify-email"
      ? { href: "/verify-email", label: "Подтвердить e-mail" }
      : model.action === "tariffs"
        ? { href: "/tariffs", label: "Выбрать тариф" }
        : null;
}

export function referralUsesPoints(program: ReferralProgram) {
  return program.rewardType === "POINTS";
}
