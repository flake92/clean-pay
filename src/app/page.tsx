"use client";

import Link from "next/link";

import { AppShell } from "@/frontend/components/layout";
import { getBranding } from "@/shared/branding";

const actions = [
  {
    href: "/cabinet",
    icon: "pi pi-home",
    title: "РљР°Р±РёРЅРµС‚",
    value: "РџРѕРґРїРёСЃРєР°",
    description: "РЎС‚Р°С‚СѓСЃ, СѓСЃС‚СЂРѕР№СЃС‚РІР° Рё СЃСЃС‹Р»РєР° РґРѕСЃС‚СѓРїР°",
    tone: "blue",
  },
  {
    href: "/profile",
    icon: "pi pi-user",
    title: "РџСЂРѕС„РёР»СЊ",
    value: "РђРєРєР°СѓРЅС‚",
    description: "E-mail, РїР°СЂРѕР»СЊ Рё Telegram ID",
    tone: "green",
  },
  {
    href: "/link-account",
    icon: "pi pi-link",
    title: "РџСЂРёРІСЏР·Р°С‚СЊ Telegram",
    value: "РЎРІСЏР·СЊ Р°РєРєР°СѓРЅС‚Р°",
    description: "Р”РѕР±Р°РІРёС‚СЊ Telegram ID Рє С‚РµРєСѓС‰РµРјСѓ РїСЂРѕС„РёР»СЋ",
    tone: "cyan",
  },
  {
    href: "/support",
    icon: "pi pi-question-circle",
    title: "РџРѕРґРґРµСЂР¶РєР°",
    value: "РџРѕРјРѕС‰СЊ",
    description: "РљРѕРЅС‚Р°РєС‚С‹ Рё РѕС‚РІРµС‚С‹ РїРѕ РѕРїР»Р°С‚Рµ",
    tone: "purple",
  },
];

export default function Home() {
  const branding = getBranding();

  return (
    <AppShell>
      <div className="grid">
        <div className="col-12">
          <div className="card">
            <div className="flex flex-column md:flex-row md:align-items-center md:justify-content-between gap-4">
              <div>
                <span className="block text-600 font-medium mb-3">{branding.name}</span>
                <div className="text-900 font-medium text-4xl mb-3">
                  Web-РєР°Р±РёРЅРµС‚ РґР»СЏ РѕРїР»Р°С‚С‹ Рё СѓРїСЂР°РІР»РµРЅРёСЏ РїРѕРґРїРёСЃРєРѕР№
                </div>
                <p className="m-0 text-600 line-height-3 max-w-40rem">
                  РљР°Р±РёРЅРµС‚ РїРѕРјРѕРіР°РµС‚ РѕРїР»Р°С‡РёРІР°С‚СЊ, РїСЂРѕРґР»РµРІР°С‚СЊ РїРѕРґРїРёСЃРєСѓ Рё СѓРїСЂР°РІР»СЏС‚СЊ VPN-РґРѕСЃС‚СѓРїРѕРј.
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                <Link href="/login" className="p-button p-component no-underline">
                  <span className="p-button-icon p-c pi pi-sign-in" />
                  <span className="p-button-label">Р’РѕР№С‚Рё</span>
                </Link>
                <Link href="/tariffs" className="p-button p-component p-button-outlined no-underline">
                  <span className="p-button-label">РўР°СЂРёС„С‹</span>
                </Link>
              </div>
            </div>
          </div>
        </div>

        {actions.map((action) => (
          <div className="col-12 lg:col-6 xl:col-3" key={action.href}>
            <Link href={action.href} className="card mb-0 no-underline block h-full">
              <div className="flex justify-content-between mb-3">
                <div>
                  <span className="block text-500 font-medium mb-3">{action.title}</span>
                  <div className="text-900 font-medium text-xl">{action.value}</div>
                </div>
                <div
                  className={`flex align-items-center justify-content-center bg-${action.tone}-100 border-round`}
                  style={{ width: "2.5rem", height: "2.5rem" }}
                >
                  <i className={`${action.icon} text-${action.tone}-500 text-xl`} />
                </div>
              </div>
              <span className="text-500">{action.description}</span>
            </Link>
          </div>
        ))}
      </div>
    </AppShell>
  );
}
