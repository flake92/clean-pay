"use client";

import Link from "next/link";

import { AppShell } from "@/frontend/components/layout";

const actions = [
  {
    href: "/cabinet",
    icon: "pi pi-home",
    title: "Кабинет",
    value: "Подписка",
    description: "Статус, устройства и ссылка доступа",
    tone: "blue",
  },
  {
    href: "/profile",
    icon: "pi pi-user",
    title: "Профиль",
    value: "Аккаунт",
    description: "E-mail, пароль и Telegram ID",
    tone: "green",
  },
  {
    href: "/link-account",
    icon: "pi pi-link",
    title: "Привязать Telegram",
    value: "Связь аккаунта",
    description: "Добавить Telegram ID к текущему профилю",
    tone: "cyan",
  },
  {
    href: "/support",
    icon: "pi pi-question-circle",
    title: "Поддержка",
    value: "Помощь",
    description: "Контакты и ответы по оплате",
    tone: "purple",
  },
];

export default function Home() {
  return (
    <AppShell>
      <div className="grid">
        <div className="col-12">
          <div className="card">
            <div className="flex flex-column md:flex-row md:align-items-center md:justify-content-between gap-4">
              <div>
                <span className="block text-600 font-medium mb-3">CleanVPN</span>
                <div className="text-900 font-medium text-4xl mb-3">
                  Web-кабинет для оплаты и управления подпиской
                </div>
                <p className="m-0 text-600 line-height-3 max-w-40rem">
                  Кабинет помогает оплачивать, продлевать подписку и управлять VPN-доступом.
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                <Link href="/login" className="p-button p-component no-underline">
                  <span className="p-button-icon p-c pi pi-sign-in" />
                  <span className="p-button-label">Войти</span>
                </Link>
                <Link href="/tariffs" className="p-button p-component p-button-outlined no-underline">
                  <span className="p-button-label">Тарифы</span>
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
