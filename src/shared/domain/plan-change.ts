/**
 * What a plan change or a gift code does to the current subscription, as
 * Remnashop computes it (the same numbers the Telegram bot shows).
 */

export type ChangeQuoteMode = "NEW" | "OFF" | "NONE" | "CREDIT";

export type ChangeQuote = {
  mode: ChangeQuoteMode;
  left_days: number;
  credit_days: number;
  /** null for an unlimited duration */
  expire_at: string | null;
};

export type GiftOutcomeKind =
  | "NEW"
  | "RESTART"
  | "EXTEND"
  | "CONVERT"
  | "KEEP_DAYS"
  | "UNLIMITED";

export type GiftOutcome = {
  kind: GiftOutcomeKind;
  plan_name: string;
  gift_days: number;
  /** null for an unlimited result */
  expire_at: string | null;
  current_plan_name: string | null;
  remaining_days: number;
  credit_days: number;
};

export type PromocodePreview = {
  reward_type: string;
  is_gift: boolean;
  gift: GiftOutcome | null;
};

export const CHANGE_QUOTE_MODES: readonly ChangeQuoteMode[] = ["NEW", "OFF", "NONE", "CREDIT"];
export const GIFT_OUTCOME_KINDS: readonly GiftOutcomeKind[] = [
  "NEW",
  "RESTART",
  "EXTEND",
  "CONVERT",
  "KEEP_DAYS",
  "UNLIMITED",
];

export type OutcomeSummary = {
  headline: string;
  lines: string[];
};

function formatDate(value: string | null) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toLocaleDateString("ru-RU");
}

function untilLine(value: string | null) {
  const date = formatDate(value);
  return date ? `Подписка будет действовать до: ${date}` : "Срок: бессрочно";
}

/** The confirm-screen text for buying another plan while a subscription is active. */
export function changeQuoteSummary(quote: ChangeQuote): OutcomeSummary | null {
  switch (quote.mode) {
    case "NEW":
      return null;
    case "CREDIT":
      return {
        headline: "Текущая подписка будет заменена выбранной с перерасчётом.",
        lines: [
          `Осталось: ${quote.left_days} дн. по текущему тарифу`,
          `Перерасчёт: +${quote.credit_days} дн. по стоимости нового тарифа`,
          untilLine(quote.expire_at),
        ],
      };
    case "NONE":
      return {
        headline:
          "Текущая подписка будет заменена выбранной. Остатка для перерасчёта нет — новый срок считается с даты оплаты.",
        lines: [untilLine(quote.expire_at)],
      };
    case "OFF":
      return {
        headline: "Текущая подписка будет заменена выбранной без пересчёта оставшегося срока.",
        lines: [untilLine(quote.expire_at)],
      };
  }
}

/** The confirmation text shown before a gift code is redeemed. */
export function giftOutcomeSummary(outcome: GiftOutcome): OutcomeSummary {
  const gift = outcome.kind === "UNLIMITED"
    ? `Подарок: тариф «${outcome.plan_name}» бессрочно.`
    : `Подарок: тариф «${outcome.plan_name}» на ${outcome.gift_days} дн.`;
  const current = outcome.current_plan_name ?? "текущего";
  switch (outcome.kind) {
    case "NEW":
      return {
        headline: `${gift} У вас пока нет подписки — будет создана новая.`,
        lines: [untilLine(outcome.expire_at)],
      };
    case "RESTART":
      return {
        headline: `${gift} Текущая подписка (пробная или закончившаяся) будет заменена подарком — срок считается с момента активации.`,
        lines: [untilLine(outcome.expire_at)],
      };
    case "EXTEND":
      return {
        headline: `${gift} Ваша подписка продлится на срок подарка.`,
        lines: [
          `Осталось: ${outcome.remaining_days} дн.`,
          `Подарок: +${outcome.gift_days} дн.`,
          untilLine(outcome.expire_at),
        ],
      };
    case "CONVERT":
      return {
        headline: `${gift} Тариф изменится с «${current}» на «${outcome.plan_name}» с перерасчётом.`,
        lines: [
          `Осталось: ${outcome.remaining_days} дн. по текущему тарифу`,
          `Перерасчёт: +${outcome.credit_days} дн. по стоимости тарифа подарка`,
          `Подарок: +${outcome.gift_days} дн.`,
          untilLine(outcome.expire_at),
        ],
      };
    case "KEEP_DAYS":
      return {
        headline: `${gift} Тариф изменится с «${current}» на «${outcome.plan_name}», оставшиеся дни сохранятся.`,
        lines: [
          `Осталось: ${outcome.remaining_days} дн.`,
          `Подарок: +${outcome.gift_days} дн.`,
          untilLine(outcome.expire_at),
        ],
      };
    case "UNLIMITED":
      return { headline: `${gift} Подписка станет бессрочной.`, lines: [untilLine(null)] };
  }
}
