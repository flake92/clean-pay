"use client";

import Image from "next/image";
import { createPortal } from "react-dom";

import { useModalDialogFocus } from "@/frontend/hooks/use-modal-dialog-focus";
import { getBranding } from "@/shared/branding";

type IosInstallGuideProps = {
  onClose: () => void;
};

const panelStyle = {
  background: "var(--surface-ground)",
  border: "1px solid var(--surface-border)",
  borderRadius: "1rem",
  padding: "1rem",
} as const;

function ShareToolbarPreview({ brandName }: { brandName: string }) {
  return (
    <div aria-hidden="true" style={panelStyle}>
      <div className="flex align-items-center justify-content-between gap-2">
        <span className="text-600" style={{ fontSize: "1.35rem" }}>‹</span>
        <div
          className="flex align-items-center justify-content-center gap-2 flex-1"
          style={{ background: "var(--surface-card)", borderRadius: "1.25rem", minHeight: "2.75rem", padding: "0.5rem 0.75rem" }}
        >
          <i className="pi pi-lock text-500" />
          <span className="text-700 text-sm">{brandName}</span>
        </div>
        <span
          className="flex align-items-center justify-content-center"
          style={{ background: "color-mix(in srgb, #6366f1 18%, transparent)", border: "2px solid #6366f1", borderRadius: "50%", height: "2.75rem", width: "2.75rem" }}
        >
          <i className="pi pi-ellipsis-h text-primary" style={{ fontSize: "1.2rem" }} />
        </span>
      </div>
      <div className="text-center text-primary font-semibold text-sm mt-2">Нажмите «•••», затем «Поделиться»</div>
    </div>
  );
}

function HomeScreenMenuPreview() {
  return (
    <div aria-hidden="true" style={panelStyle}>
      <div className="flex align-items-center gap-3" style={{ background: "var(--surface-card)", borderRadius: "0.8rem", padding: "0.9rem" }}>
        <span
          className="flex align-items-center justify-content-center flex-shrink-0"
          style={{ border: "2px solid #6366f1", borderRadius: "0.45rem", height: "2rem", width: "2rem" }}
        >
          <i className="pi pi-plus text-primary" />
        </span>
        <span className="font-semibold text-900">На экран «Домой»</span>
      </div>
    </div>
  );
}

function ConfirmationPreview({ brandName }: { brandName: string }) {
  return (
    <div aria-hidden="true" style={panelStyle}>
      <div className="flex align-items-center gap-3">
        <Image
          alt=""
          height={56}
          src="/clean-pay-icon-192.png?v=3"
          style={{ borderRadius: "0.8rem", objectFit: "cover" }}
          unoptimized
          width={56}
        />
        <div className="flex-1 min-w-0">
          <div className="font-semibold text-900">{brandName}</div>
          <div className="text-500 text-sm text-overflow-ellipsis overflow-hidden">Личный кабинет</div>
        </div>
        <span className="text-primary font-semibold">Добавить</span>
      </div>
      <div className="flex align-items-center justify-content-between gap-3 mt-3">
        <span className="text-900 text-sm">Открыть как веб‑приложение</span>
        <span
          className="flex-shrink-0"
          style={{ background: "#22c55e", borderRadius: "1rem", display: "block", height: "1.5rem", padding: "0.125rem 0.125rem 0.125rem 1.125rem", width: "2.5rem" }}
        >
          <span style={{ background: "white", borderRadius: "50%", display: "block", height: "1.25rem", width: "1.25rem" }} />
        </span>
      </div>
    </div>
  );
}

export function IosInstallGuide({ onClose }: IosInstallGuideProps) {
  const branding = getBranding();
  const dialogRef = useModalDialogFocus(onClose);

  // On <body>: the animated auth card would otherwise become the containing
  // block of this fixed overlay and squeeze it into the card.
  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="install-ios-title"
      ref={dialogRef}
      tabIndex={-1}
      style={{
        alignItems: "flex-end",
        background: "rgba(15, 23, 42, 0.55)",
        display: "flex",
        inset: 0,
        justifyContent: "center",
        padding: "max(0.75rem, env(safe-area-inset-top)) 0.75rem max(0.75rem, env(safe-area-inset-bottom))",
        position: "fixed",
        zIndex: 1100,
      }}
    >
      <div
        style={{
          background: "var(--surface-card)",
          borderRadius: "1.5rem",
          boxShadow: "0 24px 70px rgba(15, 23, 42, 0.3)",
          maxHeight: "100%",
          maxWidth: "31rem",
          overflowY: "auto",
          overscrollBehavior: "contain",
          padding: "1.25rem",
          textAlign: "left",
          width: "100%",
        }}
      >
        <div className="flex align-items-center justify-content-between gap-3 mb-2">
          <div className="text-primary font-semibold text-sm">ИНСТРУКЦИЯ ДЛЯ IPHONE И IPAD</div>
          <button
            type="button"
            className="p-button p-component p-button-rounded p-button-text p-button-secondary flex-shrink-0"
            aria-label="Закрыть инструкцию"
            onClick={onClose}
          >
            <span className="p-button-icon pi pi-times" />
          </button>
        </div>
        <h2 id="install-ios-title" className="mt-0 mb-3 text-900" style={{ fontSize: "clamp(1.6rem, 7vw, 2.15rem)", lineHeight: 1.12 }}>
          Как добавить {branding.name} на экран «Домой»
        </h2>

        <p className="mt-0 mb-4 text-600 line-height-3">
          Установка выполняется средствами Safari. Значок будет открывать личный кабинет как отдельное приложение с названием и логотипом {branding.name}.
        </p>

        <ol className="list-none p-0 m-0 flex flex-column gap-4">
          <li>
            <div className="flex align-items-center gap-2 mb-2">
              <span className="flex align-items-center justify-content-center font-bold border-circle flex-shrink-0" style={{ background: "#6366f1", color: "white", height: "2rem", width: "2rem" }}>1</span>
              <strong className="text-900 text-lg">Откройте меню Safari</strong>
            </div>
            <p className="text-600 line-height-3 mt-0 mb-2">
              Нажмите <strong>«•••»</strong> рядом с адресной строкой, затем <strong>«Поделиться»</strong>. Если кнопки «•••» нет, сразу нажмите значок «Поделиться» — квадрат со стрелкой вверх на панели Safari.
            </p>
            <ShareToolbarPreview brandName={branding.name} />
          </li>

          <li>
            <div className="flex align-items-center gap-2 mb-2">
              <span className="flex align-items-center justify-content-center font-bold border-circle flex-shrink-0" style={{ background: "#6366f1", color: "white", height: "2rem", width: "2rem" }}>2</span>
              <strong className="text-900 text-lg">Выберите нужное действие</strong>
            </div>
            <p className="text-600 line-height-3 mt-0 mb-2">
              Прокрутите список вниз и нажмите <strong>«На экран “Домой”»</strong>.
            </p>
            <HomeScreenMenuPreview />
          </li>

          <li>
            <div className="flex align-items-center gap-2 mb-2">
              <span className="flex align-items-center justify-content-center font-bold border-circle flex-shrink-0" style={{ background: "#6366f1", color: "white", height: "2rem", width: "2rem" }}>3</span>
              <strong className="text-900 text-lg">Подтвердите добавление</strong>
            </div>
            <p className="text-600 line-height-3 mt-0 mb-2">
              Проверьте, что переключатель <strong>«Открыть как веб‑приложение»</strong> включён: без него не будет уведомлений. Затем нажмите <strong>«Добавить»</strong>, и значок {branding.name} появится на экране «Домой».
            </p>
            <ConfirmationPreview brandName={branding.name} />
          </li>
        </ol>

        <div className="mt-4 p-3 border-round-lg" style={{ background: "color-mix(in srgb, #6366f1 12%, var(--surface-card))" }}>
          <div className="font-semibold text-900 mb-1">Пункта «На экран “Домой”» нет?</div>
          <div className="text-600 text-sm line-height-3">
            Убедитесь, что страница открыта именно в Safari, а не во встроенном окне Telegram. Если пункта всё равно нет, прокрутите список до конца, нажмите «Редактировать действия» и добавьте «На экран “Домой”».
          </div>
        </div>

        <button type="button" className="p-button p-component w-full mt-4" onClick={onClose}>
          <span className="p-button-label">Понятно</span>
        </button>
      </div>
    </div>,
    document.body,
  );
}
