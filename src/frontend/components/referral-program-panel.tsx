"use client";

import { Button } from "primereact/button";
import { InputText } from "primereact/inputtext";
import { Message } from "primereact/message";
import { Tag } from "primereact/tag";

import type { ReferralProgramViewModel } from "@/application/models/referral";
import { Metric } from "@/frontend/components/cabinet-view-parts";
import { LinkButton } from "@/frontend/components/prime/link-button";
import {
  referralAccrualDescription,
  referralErrorAction,
  referralRewardDescription,
  referralUsesPoints,
} from "@/frontend/components/referral-program-presentation";
import { useReferralProgramController } from "@/frontend/hooks/use-referral-program-controller";

export {
  referralAccrualDescription,
  referralRewardDescription,
};

function ErrorPanel({ model }: { model: Extract<ReferralProgramViewModel, { status: "error" }> }) {
  const action = referralErrorAction(model);

  return (
    <div className="card flex flex-column gap-3">
      <Message severity="warn" text={model.message} />
      {action ? <LinkButton className="w-fit" href={action.href} label={action.label} /> : null}
    </div>
  );
}

export function ReferralProgramPanel({ model }: { model: ReferralProgramViewModel }) {
  const { copyLink, feedback, shareLink } = useReferralProgramController({
    referralUrl: model.status === "ready" ? model.program.webReferralUrl : null,
  });
  if (model.status === "error") return <ErrorPanel model={model} />;

  const { program } = model;
  const points = referralUsesPoints(program);

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
