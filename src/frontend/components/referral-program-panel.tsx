"use client";

import { useState } from "react";

import { Button } from "primereact/button";
import { InputText } from "primereact/inputtext";
import { Message } from "primereact/message";
import { Tag } from "primereact/tag";

import type {
  ReferralProgram,
  ReferralProgramViewModel,
  ReferralRewardLevel,
} from "@/application/models/referral";
import { Metric } from "@/frontend/components/cabinet-view-parts";
import { LinkButton } from "@/frontend/components/prime/link-button";
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
    const basis = program.rewardType === "POINTS" ? "стоимости платежа" : "оплаченного срока";
    return `${audience}: ${reward.value}% от ${basis}.`;
  }
  if (program.rewardType === "POINTS") {
    const unit = russianPlural(reward.value, "балл", "балла", "баллов");
    return `${audience}: ${reward.value} ${unit}.`;
  }
  const unit = russianPlural(reward.value, "дополнительный день", "дополнительных дня", "дополнительных дней");
  return `${audience}: ${reward.value} ${unit}.`;
}

async function copyText(value: string) {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(value);
    return;
  }

  const input = document.createElement("textarea");
  input.value = value;
  input.style.position = "fixed";
  input.style.opacity = "0";
  document.body.append(input);
  input.select();
  const copied = document.execCommand("copy");
  input.remove();
  if (!copied) throw new Error("Copy failed");
}

function ErrorPanel({ model }: { model: Extract<ReferralProgramViewModel, { status: "error" }> }) {
  const action = model.action === "recover-session"
    ? { href: providerSessionRecoveryPath("/referral"), label: "Продолжить" }
    : model.action === "login"
    ? { href: sessionRefreshPath("/referral"), label: "Войти" }
    : model.action === "verify-email"
      ? { href: "/verify-email", label: "Подтвердить e-mail" }
      : model.action === "tariffs"
        ? { href: "/tariffs", label: "Выбрать тариф" }
        : null;

  return (
    <div className="card flex flex-column gap-3">
      <Message severity="warn" text={model.message} />
      {action ? <LinkButton className="w-fit" href={action.href} label={action.label} /> : null}
    </div>
  );
}

export function ReferralProgramPanel({ model }: { model: ReferralProgramViewModel }) {
  const [feedback, setFeedback] = useState<string | null>(null);
  if (model.status === "error") return <ErrorPanel model={model} />;

  const { program } = model;
  const points = program.rewardType === "POINTS";

  async function copyLink() {
    try {
      await copyText(program.webReferralUrl);
      setFeedback("Ссылка скопирована.");
    } catch {
      setFeedback("Не удалось скопировать ссылку. Выделите её вручную.");
    }
  }

  async function shareLink() {
    try {
      if (navigator.share) {
        await navigator.share({
          title: "Приглашение",
          text: "Присоединяйтесь по моей ссылке",
          url: program.webReferralUrl,
        });
        setFeedback("Ссылка отправлена.");
        return;
      }
      await copyText(program.webReferralUrl);
      setFeedback("Функция отправки недоступна — ссылка скопирована.");
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") return;
      setFeedback("Не удалось отправить ссылку.");
    }
  }

  return (
    <div className="flex flex-column gap-4">
      <section className="card flex flex-column gap-3" aria-labelledby="referral-link-title">
        <div className="flex flex-wrap align-items-center justify-content-between gap-2">
          <div>
            <h2 className="m-0 text-xl" id="referral-link-title">Ваша ссылка</h2>
            <p className="mt-2 mb-0 text-600">Друг зарегистрируется и перейдёт к выбору тарифа по этой ссылке.</p>
          </div>
          <Tag severity={points ? "info" : "success"} value={points ? "Награда: баллы" : "Награда: дни"} />
        </div>
        <div className="flex flex-column md:flex-row gap-2">
          <InputText
            aria-label="Реферальная ссылка"
            className="flex-1 min-w-0"
            readOnly
            value={program.webReferralUrl}
          />
          <Button icon="pi pi-copy" label="Скопировать" onClick={() => void copyLink()} type="button" />
          <Button icon="pi pi-share-alt" label="Поделиться" onClick={() => void shareLink()} outlined type="button" />
        </div>
        {feedback ? <Message severity={feedback.startsWith("Не удалось") ? "error" : "success"} text={feedback} /> : null}
      </section>

      <section aria-label="Статистика приглашений" className="grid">
        <div className="col-12 md:col-4">
          <Metric icon="pi pi-users" label="Приглашено" tone="blue" value={program.invitedCount} />
        </div>
        <div className="col-12 md:col-4">
          <Metric icon="pi pi-credit-card" label="Совершили платёж" tone="cyan" value={program.invitedWithPaymentCount} />
        </div>
        <div className="col-12 md:col-4">
          <Metric
            icon="pi pi-star"
            label="Баланс баллов"
            tone="purple"
            value={program.pointsBalance}
          />
        </div>
        {program.totalPointsIssued > 0 ? (
          <div className="col-12 md:col-4">
            <Metric
              icon="pi pi-chart-line"
              label="Начислено баллов за всё время"
              tone="purple"
              value={program.totalPointsIssued}
            />
          </div>
        ) : null}
        {program.totalDaysIssued > 0 ? (
          <div className="col-12 md:col-4">
            <Metric
              icon="pi pi-calendar-plus"
              label="Начислено доп. дней за всё время"
              tone="orange"
              value={program.totalDaysIssued}
            />
          </div>
        ) : null}
      </section>

      <section className="card" aria-labelledby="referral-reward-title">
        <h2 className="mt-0 text-xl" id="referral-reward-title">Как начисляется награда</h2>
        <Message severity="info" text={referralAccrualDescription(program)} />
        <ul className="mt-4 mb-0 pl-4 flex flex-column gap-2">
          {program.rewardLevels.map((reward) => (
            <li key={reward.level}>{referralRewardDescription(program, reward)}</li>
          ))}
        </ul>
        <p className="mb-0 mt-4 text-600">
          {[
            `Текущий баланс: ${program.pointsBalance} баллов.`,
            program.totalPointsIssued > 0
              ? `За всё время начислено ${program.totalPointsIssued} баллов.`
              : null,
            program.totalDaysIssued > 0
              ? `За всё время к подписке добавлено ${program.totalDaysIssued} дней.`
              : null,
          ].filter(Boolean).join(" ")}
        </p>
      </section>
    </div>
  );
}
