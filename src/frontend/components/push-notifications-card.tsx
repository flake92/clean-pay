"use client";

import { Card } from "primereact/card";

import { LinkButton } from "@/frontend/components/prime/link-button";
import { Button, Message } from "@/frontend/components/sakai/form-foundation";
import { usePushNotificationsController } from "@/frontend/hooks/use-push-notifications-controller";

export function PushNotificationsCard({ available }: { available: boolean }) {
  const { status, pending, message, enable, disable } = usePushNotificationsController(available);

  if (status === "hidden") return null;

  return (
    <Card title="Уведомления на этом устройстве">
      <div className="flex flex-column gap-3">
        <p className="m-0 line-height-3 text-600">
          Push-уведомления дублируют сообщения бота: окончание подписки, трафик, оплаты и
          новости. Звук и показ на экране блокировки настраиваются в настройках телефона.
        </p>
        {message ? <Message severity={message.severity} text={message.text} /> : null}
        {status === "ios-install" ? (
          <>
            <Message
              severity="info"
              text="На iPhone и iPad уведомления работают только в установленном приложении (iOS 16.4 и новее): откройте личный кабинет в Safari, нажмите «Поделиться» → «На экран „Домой“», затем включите уведомления в приложении."
            />
            <LinkButton className="w-fit" href="/install" label="Как установить" />
          </>
        ) : null}
        {status === "unsupported" ? (
          <Message
            severity="warn"
            text="Этот браузер не поддерживает push-уведомления. Установите личный кабинет на главный экран или откройте его в Chrome, Edge, Firefox или Яндекс Браузере."
          />
        ) : null}
        {status === "denied" ? (
          <Message
            severity="warn"
            text="Уведомления запрещены в настройках браузера. Разрешите их для этого сайта в настройках браузера или телефона и обновите страницу."
          />
        ) : null}
        {status === "loading" ? (
          <p className="m-0 text-600 text-sm">Проверяем настройки устройства…</p>
        ) : null}
        {status === "off" ? (
          <Button
            className="w-fit"
            disabled={pending}
            icon="pi pi-bell"
            label="Включить уведомления"
            loading={pending}
            onClick={() => void enable()}
          />
        ) : null}
        {status === "on" ? (
          <div className="flex flex-column gap-2">
            <span className="flex align-items-center gap-2 font-medium">
              <i aria-hidden className="pi pi-check-circle text-green-500" />
              Уведомления включены на этом устройстве
            </span>
            <Button
              className="w-fit"
              disabled={pending}
              label="Отключить на этом устройстве"
              loading={pending}
              onClick={() => void disable()}
              outlined
              severity="secondary"
            />
          </div>
        ) : null}
      </div>
    </Card>
  );
}
