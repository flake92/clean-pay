"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";

import { IosInstallGuide } from "@/frontend/components/ios-install-guide";
import {
  loadTelegramWebAppScript,
  openTelegramExternalLink,
  wasOpenedInTelegramWebApp,
} from "@/frontend/lib/telegram-webapp";

type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
};

function isAppleMobileDevice() {
  if (typeof navigator === "undefined") return false;
  return /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.userAgent.includes("Mac") && navigator.maxTouchPoints > 1);
}

function isAndroidDevice() {
  if (typeof navigator === "undefined") return false;
  return /Android/i.test(navigator.userAgent);
}

function isEmbeddedMobileBrowser() {
  if (typeof navigator === "undefined") return false;

  return wasOpenedInTelegramWebApp() || /Telegram|FBAN|FBAV|Instagram|Line\/|; wv\)|\bwv\b/i.test(navigator.userAgent);
}

function androidBrowserName() {
  if (/SamsungBrowser/i.test(navigator.userAgent)) return "Samsung Internet";
  if (/YaBrowser/i.test(navigator.userAgent)) return "Яндекс Браузер";
  if (/OPR|Opera/i.test(navigator.userAgent)) return "Opera";
  if (/Firefox/i.test(navigator.userAgent)) return "Firefox";
  return "браузер";
}

function isStandalone() {
  return window.matchMedia("(display-mode: standalone)").matches || ("standalone" in navigator && (navigator as Navigator & { standalone?: boolean }).standalone === true);
}

export function InstallAppButton({
  alwaysVisible = false,
  autoOpenIosGuide = alwaysVisible,
}: {
  alwaysVisible?: boolean;
  autoOpenIosGuide?: boolean;
}) {
  const [installEvent, setInstallEvent] = useState<BeforeInstallPromptEvent | null>(null);
  const [showIosGuide, setShowIosGuide] = useState(false);
  const [showAndroidGuide, setShowAndroidGuide] = useState(false);
  const [showEmbeddedGuide, setShowEmbeddedGuide] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [installed, setInstalled] = useState(false);
  const [mobilePlatform, setMobilePlatform] = useState<"android" | "ios" | "other" | null>(null);
  const [embeddedBrowser, setEmbeddedBrowser] = useState(false);
  const [installPending, setInstallPending] = useState(false);
  const installPendingRef = useRef(false);

  useEffect(() => {
    const platformTimer = window.setTimeout(() => {
      const isIos = isAppleMobileDevice();
      const requestedPlatform = new URLSearchParams(window.location.search).get("platform");
      setInstalled((current) => current || isStandalone());
      setMobilePlatform(isIos ? "ios" : isAndroidDevice() ? "android" : "other");
      const embedded = isEmbeddedMobileBrowser();
      setEmbeddedBrowser(embedded);

      if (
        autoOpenIosGuide &&
        (isIos || requestedPlatform === "ios") &&
        !embedded &&
        !isStandalone()
      ) {
        setShowIosGuide(true);
      }

      if (embedded) {
        void loadTelegramWebAppScript().catch(() => undefined);
      }
    }, 0);
    const onBeforeInstallPrompt = (event: Event) => {
      event.preventDefault();
      setMessage(null);
      setInstallEvent(event as BeforeInstallPromptEvent);
    };
    const onInstalled = () => {
      setMessage(null);
      setInstallEvent(null);
      setInstalled(true);
    };
    window.addEventListener("beforeinstallprompt", onBeforeInstallPrompt);
    window.addEventListener("appinstalled", onInstalled);

    if ("serviceWorker" in navigator) {
      void navigator.serviceWorker
        .register("/sw.js", { scope: "/", updateViaCache: "none" })
        .then((registration) => registration.update())
        .catch(() => undefined);
    }

    return () => { window.clearTimeout(platformTimer); window.removeEventListener("beforeinstallprompt", onBeforeInstallPrompt); window.removeEventListener("appinstalled", onInstalled); };
  }, [autoOpenIosGuide]);

  function openExternalInstallPage() {
    const installUrl = new URL("/install", window.location.origin);
    installUrl.searchParams.set("source", "telegram");
    installUrl.searchParams.set("platform", isAppleMobileDevice() ? "ios" : isAndroidDevice() ? "android" : "other");

    if (!openTelegramExternalLink(installUrl.toString())) {
      setShowEmbeddedGuide(true);
    }
  }

  async function install() {
    if (installPendingRef.current) return;
    setMessage(null);
    if (embeddedBrowser) { openExternalInstallPage(); return; }
    if (isAppleMobileDevice()) { setShowIosGuide(true); return; }
    if (!installEvent && isAndroidDevice()) { setShowAndroidGuide(true); return; }
    if (!installEvent) {
      setMessage("Если системное окно установки не появилось, откройте меню браузера и выберите «Установить приложение».");
      return;
    }
    installPendingRef.current = true;
    setInstallPending(true);
    try {
      await installEvent.prompt();
      const choice = await installEvent.userChoice;
      setInstallEvent(null);
      if (choice.outcome === "dismissed") setMessage(null);
    } catch {
      setInstallEvent(null);
      setMessage("Не удалось открыть системное окно установки. Попробуйте ещё раз через меню браузера.");
    } finally {
      installPendingRef.current = false;
      setInstallPending(false);
    }
  }

  if (installed) {
    if (!alwaysVisible) return null;

    return (
      <div className="flex flex-column align-items-center gap-3 text-center" role="status">
        <i className="pi pi-check-circle text-green-500" style={{ fontSize: "2rem" }} />
        <strong className="text-900 text-xl">Clean Pay уже установлен</strong>
        <span className="text-600 line-height-3">
          Ярлык уже находится на главном экране. Если хотите установить его заново, сначала удалите существующее приложение Clean Pay.
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
        <div role="dialog" aria-modal="true" aria-labelledby="install-embedded-title" style={{ background: "rgba(0, 0, 0, 0.45)", inset: 0, padding: "1rem", position: "fixed", zIndex: 1100 }}>
          <div style={{ background: "white", borderRadius: "12px", margin: "20vh auto", maxWidth: "28rem", padding: "1.5rem" }}>
            <h2 id="install-embedded-title" className="mt-0">Открыть во внешнем браузере</h2>
            <p>Telegram не разрешает устанавливать ярлыки внутри встроенного окна. Нажмите меню ⋮ в правом верхнем углу, выберите «Открыть в браузере», затем снова нажмите «Установить приложение».</p>
            <button type="button" className="p-button p-component" onClick={() => setShowEmbeddedGuide(false)}><span className="p-button-label">Понятно</span></button>
          </div>
        </div>
      ) : null}
      {showIosGuide ? <IosInstallGuide onClose={() => setShowIosGuide(false)} /> : null}
      {showAndroidGuide ? (
        <div role="dialog" aria-modal="true" aria-labelledby="install-android-title" style={{ background: "rgba(0, 0, 0, 0.45)", inset: 0, padding: "1rem", position: "fixed", zIndex: 1100 }}>
          <div style={{ background: "white", borderRadius: "12px", margin: "20vh auto", maxWidth: "28rem", padding: "1.5rem" }}>
            <h2 id="install-android-title" className="mt-0">Добавить приложение</h2>
            <p>В {androidBrowserName()} откройте меню браузера и выберите «Установить приложение» или «Добавить на главный экран».</p>
            <button type="button" className="p-button p-component" onClick={() => setShowAndroidGuide(false)}><span className="p-button-label">Понятно</span></button>
          </div>
        </div>
      ) : null}
    </>
  );
}
