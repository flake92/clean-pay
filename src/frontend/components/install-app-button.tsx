"use client";

import Link from "next/link";

import { IosInstallGuide } from "@/frontend/components/ios-install-guide";
import { useInstallAppController } from "@/frontend/hooks/use-install-app-controller";
import { useModalDialogFocus } from "@/frontend/hooks/use-modal-dialog-focus";
import { getBranding } from "@/shared/branding";

function InstallInstructionsDialog({
  children,
  onClose,
  title,
  titleId,
}: {
  children: React.ReactNode;
  onClose: () => void;
  title: string;
  titleId: string;
}) {
  const dialogRef = useModalDialogFocus(onClose);

  return (
    <div
      aria-labelledby={titleId}
      aria-modal="true"
      ref={dialogRef}
      role="dialog"
      tabIndex={-1}
      style={{ background: "rgba(0, 0, 0, 0.45)", inset: 0, padding: "1rem", position: "fixed", zIndex: 1100 }}
    >
      <div style={{ background: "white", borderRadius: "12px", margin: "20vh auto", maxWidth: "28rem", padding: "1.5rem" }}>
        <h2 className="mt-0" id={titleId}>{title}</h2>
        {children}
        <button type="button" className="p-button p-component" onClick={onClose}>
          <span className="p-button-label">Понятно</span>
        </button>
      </div>
    </div>
  );
}

export function InstallAppButton({
  alwaysVisible = false,
  autoOpenIosGuide = alwaysVisible,
}: {
  alwaysVisible?: boolean;
  autoOpenIosGuide?: boolean;
}) {
  const branding = getBranding();
  const {
    androidBrowserName,
    embeddedBrowser,
    install,
    installEvent,
    installPending,
    installed,
    message,
    mobilePlatform,
    setShowAndroidGuide,
    setShowEmbeddedGuide,
    setShowIosGuide,
    showAndroidGuide,
    showEmbeddedGuide,
    showIosGuide,
  } = useInstallAppController({ autoOpenIosGuide });

  if (installed) {
    if (!alwaysVisible) return null;

    return (
      <div className="flex flex-column align-items-center gap-3 text-center" role="status">
        <i className="pi pi-check-circle text-green-500" style={{ fontSize: "2rem" }} />
        <strong className="text-900 text-xl">{branding.name} уже установлен</strong>
        <span className="text-600 line-height-3">
          Ярлык уже находится на главном экране. Если хотите установить его заново, сначала удалите существующее приложение {branding.name}.
        </span>
        <Link className="p-button p-component no-underline" href="/cabinet" prefetch={false}>
          <span className="p-button-icon p-c pi pi-home" />
          <span className="p-button-label">Открыть кабинет</span>
        </Link>
      </div>
    );
  }

  if (
    !alwaysVisible
    && mobilePlatform !== "android"
    && mobilePlatform !== "ios"
    && !installEvent
    && !message
  ) return null;

  return (
    <>
      <button
        aria-busy={installPending}
        className="p-button p-component p-button-outlined"
        disabled={installPending}
        onClick={() => void install()}
        type="button"
      >
        <span className="p-button-icon p-c pi pi-mobile" />
        <span className="p-button-label">{embeddedBrowser ? "Открыть установку в браузере" : "Установить приложение"}</span>
      </button>
      {message ? <p className="m-0 text-sm text-600">{message}</p> : null}
      {showEmbeddedGuide ? (
        <InstallInstructionsDialog
          onClose={() => setShowEmbeddedGuide(false)}
          title="Открыть во внешнем браузере"
          titleId="install-embedded-title"
        >
          <p>Telegram не разрешает устанавливать ярлыки внутри встроенного окна. Нажмите меню ⋮ в правом верхнем углу, выберите «Открыть в браузере», затем снова нажмите «Установить приложение».</p>
        </InstallInstructionsDialog>
      ) : null}
      {showIosGuide ? <IosInstallGuide onClose={() => setShowIosGuide(false)} /> : null}
      {showAndroidGuide ? (
        <InstallInstructionsDialog
          onClose={() => setShowAndroidGuide(false)}
          title="Добавить приложение"
          titleId="install-android-title"
        >
          <p>В {androidBrowserName()} откройте меню браузера и выберите «Установить приложение» или «Добавить на главный экран».</p>
        </InstallInstructionsDialog>
      ) : null}
    </>
  );
}
