"use client";

import Link from "next/link";

import { AppShell } from "@/components/layout";

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

        <div className="col-12 lg:col-6 xl:col-3">
          <div className="card mb-0">
            <div className="flex justify-content-between mb-3">
              <div>
                <span className="block text-500 font-medium mb-3">Слой доступа</span>
                <div className="text-900 font-medium text-xl">BFF</div>
              </div>
              <div className="flex align-items-center justify-content-center bg-blue-100 border-round" style={{ width: "2.5rem", height: "2.5rem" }}>
                <i className="pi pi-server text-blue-500 text-xl" />
              </div>
            </div>
            <span className="text-green-500 font-medium">API </span>
            <span className="text-500">скрыт от браузера</span>
          </div>
        </div>
        <div className="col-12 lg:col-6 xl:col-3">
          <div className="card mb-0">
            <div className="flex justify-content-between mb-3">
              <div>
                <span className="block text-500 font-medium mb-3">Сессии</span>
                <div className="text-900 font-medium text-xl">HttpOnly</div>
              </div>
              <div className="flex align-items-center justify-content-center bg-orange-100 border-round" style={{ width: "2.5rem", height: "2.5rem" }}>
                <i className="pi pi-lock text-orange-500 text-xl" />
              </div>
            </div>
            <span className="text-green-500 font-medium">Cookies </span>
            <span className="text-500">для web-кабинета</span>
          </div>
        </div>
        <div className="col-12 lg:col-6 xl:col-3">
          <div className="card mb-0">
            <div className="flex justify-content-between mb-3">
              <div>
                <span className="block text-500 font-medium mb-3">Подписка</span>
                <div className="text-900 font-medium text-xl">CleanVPN</div>
              </div>
              <div className="flex align-items-center justify-content-center bg-cyan-100 border-round" style={{ width: "2.5rem", height: "2.5rem" }}>
                <i className="pi pi-database text-cyan-500 text-xl" />
              </div>
            </div>
            <span className="text-green-500 font-medium">Тарифы </span>
            <span className="text-500">и платежи</span>
          </div>
        </div>
        <div className="col-12 lg:col-6 xl:col-3">
          <div className="card mb-0">
            <div className="flex justify-content-between mb-3">
              <div>
                <span className="block text-500 font-medium mb-3">Кабинет</span>
                <div className="text-900 font-medium text-xl">Clean Pay</div>
              </div>
              <div className="flex align-items-center justify-content-center bg-purple-100 border-round" style={{ width: "2.5rem", height: "2.5rem" }}>
                <i className="pi pi-wallet text-purple-500 text-xl" />
              </div>
            </div>
            <span className="text-green-500 font-medium">Оплата </span>
            <span className="text-500">и продление</span>
          </div>
        </div>

        <div className="col-12">
          <div className="card">
            <h5>Быстрые действия</h5>
            <div className="flex flex-wrap gap-2">
              <Link href="/cabinet" className="p-button p-component p-button-outlined no-underline">
                <span className="p-button-label">Кабинет</span>
              </Link>
              <Link href="/profile" className="p-button p-component p-button-outlined no-underline">
                <span className="p-button-label">Профиль</span>
              </Link>
              <Link href="/link-account" className="p-button p-component p-button-outlined no-underline">
                <span className="p-button-icon p-c pi pi-send" />
                <span className="p-button-label">Привязать Telegram</span>
              </Link>
              <Link href="/support" className="p-button p-component p-button-outlined no-underline">
                <span className="p-button-label">Поддержка</span>
              </Link>
            </div>
          </div>
        </div>
      </div>
    </AppShell>
  );
}
