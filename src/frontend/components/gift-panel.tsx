"use client";

import { useState } from "react";
import { Card } from "primereact/card";
import { Tag } from "primereact/tag";

import { AccountActionRequired } from "@/frontend/components/account-action-required";
import { Button, Message } from "@/frontend/components/sakai/form-foundation";
import {
  paymentDeviceLimitLabel,
  paymentDurationLabel,
  paymentTrafficLabel,
} from "@/frontend/components/payment-confirmation-presentation";
import { TariffsPanel } from "@/frontend/components/tariffs-panel";
import type { GiftsViewModel } from "@/application/models/gifts";
import type { Gift, GiftStatus, ReceivedGift } from "@/shared/domain/gifts";

const statusLabel: Record<GiftStatus, { text: string; severity: "success" | "info" | "warning" }> = {
  AVAILABLE: { text: "Ждёт активации", severity: "success" },
  ACTIVATED: { text: "Активирован", severity: "info" },
  EXPIRED: { text: "Срок истёк", severity: "warning" },
};

function formatDate(value: string | null) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toLocaleDateString("ru-RU");
}

function giftMessage(gift: Gift) {
  return [
    `Дарю подписку «${gift.plan_name}» на ${paymentDurationLabel(gift.duration_days)}.`,
    `Код подарка: ${gift.code}`,
    "Активируйте его в личном кабинете в поле «Промокод».",
  ].join("\n");
}

function GiftCodeCard({ gift }: { gift: Gift }) {
  const [copied, setCopied] = useState<"code" | "message" | null>(null);
  const [copyFailed, setCopyFailed] = useState(false);
  const status = statusLabel[gift.status];
  const created = formatDate(gift.created_at);
  const expires = formatDate(gift.expires_at);
  const activated = formatDate(gift.activated_at);

  async function copy(kind: "code" | "message") {
    try {
      await navigator.clipboard.writeText(kind === "code" ? gift.code : giftMessage(gift));
      setCopyFailed(false);
      setCopied(kind);
    } catch {
      setCopyFailed(true);
    }
  }

  return (
    <Card className="shadow-1">
      <div className="flex flex-column gap-3">
        <div className="flex flex-wrap align-items-center justify-content-between gap-2">
          <div className="min-w-0">
            <h3 className="m-0 text-lg font-semibold break-words">{gift.plan_name}</h3>
            <p className="m-0 mt-1 text-sm text-600">
              {paymentDurationLabel(gift.duration_days)} ·{" "}
              {paymentDeviceLimitLabel(gift.device_limit)} устройств ·{" "}
              {paymentTrafficLabel(gift.traffic_limit)}
            </p>
          </div>
          <Tag severity={status.severity} value={status.text} />
        </div>
        <code
          aria-label="Код подарка"
          className="surface-50 border-1 border-200 border-round-lg p-3 text-xl font-semibold text-900 break-all"
        >
          {gift.code}
        </code>
        <p className="m-0 text-sm text-600">
          {created ? `Куплен ${created}. ` : ""}
          {gift.status === "ACTIVATED" && activated ? `Активирован ${activated}.` : null}
          {gift.status === "AVAILABLE" && expires ? `Действует до ${expires}.` : null}
          {gift.status === "EXPIRED" && expires ? `Срок активации истёк ${expires}.` : null}
        </p>
        {gift.status === "AVAILABLE" ? (
          <div className="flex flex-wrap gap-2">
            <Button
              icon="pi pi-copy"
              label={copied === "code" ? "Код скопирован" : "Скопировать код"}
              onClick={() => copy("code")}
              outlined
              type="button"
            />
            <Button
              icon="pi pi-send"
              label={copied === "message" ? "Сообщение скопировано" : "Скопировать сообщение"}
              onClick={() => copy("message")}
              outlined
              type="button"
            />
          </div>
        ) : null}
        {copyFailed ? (
          <Message severity="warn" text="Не удалось скопировать автоматически. Выделите код и скопируйте его вручную." />
        ) : null}
      </div>
    </Card>
  );
}

function ReceivedGiftCard({ gift }: { gift: ReceivedGift }) {
  const activated = formatDate(gift.activated_at);
  return (
    <Card className="shadow-1">
      <div className="flex flex-column gap-2">
        <div className="flex flex-wrap align-items-center justify-content-between gap-2">
          <h3 className="m-0 text-lg font-semibold break-words">{gift.plan_name}</h3>
          <Tag icon="pi pi-gift" severity="info" value="Получен" />
        </div>
        <p className="m-0 text-sm text-600">
          {paymentDurationLabel(gift.duration_days)} ·{" "}
          {paymentDeviceLimitLabel(gift.device_limit)} устройств ·{" "}
          {paymentTrafficLabel(gift.traffic_limit)}
        </p>
        <p className="m-0 text-sm text-600">
          Код <code>{gift.code}</code>{activated ? ` активирован ${activated}.` : "."}
        </p>
      </div>
    </Card>
  );
}

export function GiftPanel({ model }: { model: GiftsViewModel }) {
  if (model.status === "error") {
    if (model.action) {
      return (
        <AccountActionRequired action={model.action} message={model.message} redirectTo="/gift" />
      );
    }
    return <Message severity="error" text={model.message} />;
  }

  return (
    <div className="flex flex-column gap-6">
      <Message
        severity="info"
        text="Код действует 1 год и активируется один раз. Если у получателя уже есть подписка, подарок продлит её на свой срок, а тариф станет тарифом подарка. Подарок оплачивается по полной цене: личные скидки на него не действуют. Получатель не увидит, от кого подарок: если хотите, скажите ему сами."
      />
      <TariffsPanel mode="gift" model={{ status: "ready", offers: model.offers }} />
      <section aria-labelledby="bought-gifts" className="flex flex-column gap-3">
        <h2 className="m-0 text-xl font-semibold" id="bought-gifts">Купленные подарки</h2>
        {model.giftsError ? <Message severity="warn" text={model.giftsError} /> : null}
        {!model.giftsError && model.gifts.length === 0 ? (
          <p className="m-0 text-600">
            Здесь появятся коды после оплаты. Если оплата только что прошла, обновите страницу через минуту.
          </p>
        ) : null}
        <div className="grid">
          {model.gifts.map((gift) => (
            <div className="col-12 xl:col-6" key={gift.payment_id}>
              <GiftCodeCard gift={gift} />
            </div>
          ))}
        </div>
        <p className="m-0 text-sm text-600">
          Вы видите, активирован ли код, но не кем, а получатель не видит, кто его купил.
        </p>
      </section>
      {model.received.length > 0 ? (
        <section aria-labelledby="received-gifts" className="flex flex-column gap-3">
          <h2 className="m-0 text-xl font-semibold" id="received-gifts">Полученные подарки</h2>
          <div className="grid">
            {model.received.map((gift) => (
              <div className="col-12 xl:col-6" key={gift.code}>
                <ReceivedGiftCard gift={gift} />
              </div>
            ))}
          </div>
        </section>
      ) : null}
    </div>
  );
}
