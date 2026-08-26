import { Card } from "primereact/card";

import { LinkButton } from "@/frontend/components/prime/link-button";
import { getBranding } from "@/shared/branding";
import type { SupportViewModel } from "@/application/models/support";

export function SupportPanel({ support }: { support: SupportViewModel }) {
  const branding = getBranding();

  const hasContacts = support.email || support.telegramUsername || support.faqUrl;

  return (
    <div className="flex flex-column gap-4">
      <Card title={`Контакты ${branding.name}`}>
        {support.enabled && hasContacts ? (
          <div className="flex flex-wrap gap-3">
            {support.email ? (
              <LinkButton href={`mailto:${support.email}`} icon="pi pi-envelope" label="Написать на почту" outlined />
            ) : null}
            {support.telegramUsername ? (
              <LinkButton
                external
                href={`https://t.me/${support.telegramUsername.replace(/^@/, "")}`}
                icon="pi pi-send"
                label="Telegram"
                outlined
              />
            ) : null}
            {support.faqUrl ? (
              <LinkButton external href={support.faqUrl} icon="pi pi-book" label="FAQ и инструкции" outlined />
            ) : null}
          </div>
        ) : support.liveChatEnabled ? (
          <p className="m-0 line-height-3 text-600">
            Войдите в аккаунт, чтобы написать нам в чате поддержки.
          </p>
        ) : (
          <p className="m-0 line-height-3 text-600">Контакты поддержки пока не опубликованы.</p>
        )}
      </Card>

      <Card title="Как подключиться">
        <ol className="m-0 flex flex-column gap-3 line-height-3 text-700">
          <li>Войдите в web-кабинет и откройте раздел подписки.</li>
          <li>Купите или продлите тариф, если активной подписки нет.</li>
          <li>Нажмите кнопку подключения или скопируйте ссылку подписки.</li>
          <li>Если устройство потеряло доступ, удалите его в кабинете или перевыпустите ссылку.</li>
        </ol>
      </Card>

      <Card title="Для кого этот сайт">
        <p className="m-0 line-height-3 text-700">
          Web-кабинет {branding.name} предназначен для пользователей, которые хотят оплачивать и управлять подпиской
          без Telegram-бота.
        </p>
      </Card>
    </div>
  );
}
