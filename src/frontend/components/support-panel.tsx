"use client";

import { useEffect, useState } from "react";

import { Card } from "primereact/card";
import { Message } from "primereact/message";

import { LinkButton } from "@/frontend/components/prime/link-button";
import { readBffError } from "@/frontend/lib/client-api";
import { getBranding } from "@/shared/branding";

type SupportSettings = {
  enabled: boolean;
  email: string | null;
  telegramUsername: string | null;
  faqUrl: string | null;
};

async function readSupportSettings() {
  const response = await fetch("/api/bff/support");

  if (!response.ok) {
    throw await readBffError(response, "Не удалось загрузить контакты поддержки.");
  }

  const body = await response.json().catch(() => null);

  return body.data as SupportSettings;
}

export function SupportPanel() {
  const branding = getBranding();
  const [support, setSupport] = useState<SupportSettings | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    readSupportSettings()
      .then(setSupport)
      .catch((err: Error) => setError(err.message));
  }, []);

  if (error) {
    return <Message severity="error" text={error} />;
  }

  if (!support) {
    return <Message severity="info" text="Загрузка контактов поддержки..." />;
  }

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
        ) : (
          <p className="m-0 line-height-3 text-600">Контакты поддержки пока не опубликованы.</p>
        )}
      </Card>

      <Card title="Как подключиться">
        <ol className="m-0 flex flex-column gap-3 line-height-3 text-700">
          <li>1. Войдите в web-кабинет и откройте раздел подписки.</li>
          <li>2. Купите или продлите тариф, если активной подписки нет.</li>
          <li>3. Нажмите кнопку подключения или скопируйте ссылку подписки.</li>
          <li>4. Если устройство потеряло доступ, удалите его в кабинете или перевыпустите ссылку.</li>
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
