"use client";

import { useEffect, useState } from "react";

import { Card } from "primereact/card";
import { Message } from "primereact/message";
import { readBffError } from "@/frontend/lib/client-api";
import { LinkButton } from "@/frontend/components/prime/link-button";
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
    throw await readBffError(response, 'РќРµ СѓРґР°Р»РѕСЃСЊ Р·Р°РіСЂСѓР·РёС‚СЊ РєРѕРЅС‚Р°РєС‚С‹ РїРѕРґРґРµСЂР¶РєРё.');
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
    return <Message severity="info" text="Р—Р°РіСЂСѓР·РєР° РєРѕРЅС‚Р°РєС‚РѕРІ РїРѕРґРґРµСЂР¶РєРё..." />;
  }

  const hasContacts = support.email || support.telegramUsername || support.faqUrl;

  return (
    <div className="flex flex-column gap-4">
      <Card title={`Контакты ${branding.name}`}>
        {support.enabled && hasContacts ? (
          <div className="flex flex-wrap gap-3">
            {support.email ? (
              <LinkButton
                href={`mailto:${support.email}`}
                icon="pi pi-envelope"
                label="РќР°РїРёСЃР°С‚СЊ РЅР° РїРѕС‡С‚Сѓ"
                outlined
              />
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
              <LinkButton
                external
                href={support.faqUrl}
                icon="pi pi-book"
                label="FAQ Рё РёРЅСЃС‚СЂСѓРєС†РёРё"
                outlined
              />
            ) : null}
          </div>
        ) : (
          <p className="m-0 line-height-3 text-600">
            РљРѕРЅС‚Р°РєС‚С‹ РїРѕРґРґРµСЂР¶РєРё РїРѕРєР° РЅРµ РѕРїСѓР±Р»РёРєРѕРІР°РЅС‹. РС… РјРѕР¶РЅРѕ РІРєР»СЋС‡РёС‚СЊ С‡РµСЂРµР·
            РїРµСЂРµРјРµРЅРЅС‹Рµ РѕРєСЂСѓР¶РµРЅРёСЏ `SUPPORT_ENABLED`, `SUPPORT_EMAIL`,
            `SUPPORT_TELEGRAM_USERNAME` Рё `SUPPORT_FAQ_URL`.
          </p>
        )}
      </Card>

      <Card title="РљР°Рє РїРѕРґРєР»СЋС‡РёС‚СЊСЃСЏ">
        <ol className="m-0 flex flex-column gap-3 line-height-3 text-700">
          <li>1. Р’РѕР№РґРёС‚Рµ РІ web-РєР°Р±РёРЅРµС‚ Рё РѕС‚РєСЂРѕР№С‚Рµ СЂР°Р·РґРµР» РїРѕРґРїРёСЃРєРё.</li>
          <li>2. РљСѓРїРёС‚Рµ РёР»Рё РїСЂРѕРґР»РёС‚Рµ С‚Р°СЂРёС„, РµСЃР»Рё Р°РєС‚РёРІРЅРѕР№ РїРѕРґРїРёСЃРєРё РЅРµС‚.</li>
          <li>3. РќР°Р¶РјРёС‚Рµ РєРЅРѕРїРєСѓ РїРѕРґРєР»СЋС‡РµРЅРёСЏ РёР»Рё СЃРєРѕРїРёСЂСѓР№С‚Рµ СЃСЃС‹Р»РєСѓ РїРѕРґРїРёСЃРєРё.</li>
          <li>4. Р•СЃР»Рё СѓСЃС‚СЂРѕР№СЃС‚РІРѕ РїРѕС‚РµСЂСЏР»Рѕ РґРѕСЃС‚СѓРї, СѓРґР°Р»РёС‚Рµ РµРіРѕ РІ РєР°Р±РёРЅРµС‚Рµ РёР»Рё РїРµСЂРµРІС‹РїСѓСЃС‚РёС‚Рµ СЃСЃС‹Р»РєСѓ.</li>
        </ol>
      </Card>

      <Card title="Р”Р»СЏ РєРѕРіРѕ СЌС‚РѕС‚ СЃР°Р№С‚">
        <p className="m-0 line-height-3 text-700">
          Web-кабинет {branding.name} предназначен для пользователей, которые хотят оплачивать и управлять подпиской без Telegram-бота.
        </p>
      </Card>
    </div>
  );
}
