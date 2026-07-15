"use client";

import { useEffect, useState } from "react";

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

export function InstallAppButton({ alwaysVisible = false }: { alwaysVisible?: boolean } = {}) {
  const [installEvent, setInstallEvent] = useState<BeforeInstallPromptEvent | null>(null);
  const [showIosGuide, setShowIosGuide] = useState(false);
  const [showAndroidGuide, setShowAndroidGuide] = useState(false);
  const [showEmbeddedGuide, setShowEmbeddedGuide] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [installed, setInstalled] = useState(() => typeof window !== "undefined" && isStandalone());
  const [mobilePlatform, setMobilePlatform] = useState<"android" | "ios" | "other" | null>(null);
  const [embeddedBrowser, setEmbeddedBrowser] = useState(false);

  useEffect(() => {
    const platformTimer = window.setTimeout(() => {
      setMobilePlatform(isAppleMobileDevice() ? "ios" : isAndroidDevice() ? "android" : "other");
      const embedded = isEmbeddedMobileBrowser();
      setEmbeddedBrowser(embedded);

      if (embedded) {
        void loadTelegramWebAppScript().catch(() => undefined);
      }
    }, 0);
    const onBeforeInstallPrompt = (event: Event) => { event.preventDefault(); setInstallEvent(event as BeforeInstallPromptEvent); };
    const onInstalled = () => setInstalled(true);
    window.addEventListener("beforeinstallprompt", onBeforeInstallPrompt);
    window.addEventListener("appinstalled", onInstalled);

    if ("serviceWorker" in navigator) {
      void navigator.serviceWorker.register("/sw.js").catch(() => undefined);
    }

    return () => { window.clearTimeout(platformTimer); window.removeEventListener("beforeinstallprompt", onBeforeInstallPrompt); window.removeEventListener("appinstalled", onInstalled); };
  }, []);

  function openExternalInstallPage() {
    if (!openTelegramExternalLink(new URL("/install", window.location.origin).toString())) {
      setShowEmbeddedGuide(true);
    }
  }

  async function install() {
    setMessage(null);
    if (embeddedBrowser) { openExternalInstallPage(); return; }
    if (isAppleMobileDevice()) { setShowIosGuide(true); return; }
    if (!installEvent && isAndroidDevice()) { setShowAndroidGuide(true); return; }
    if (!installEvent) {
      setMessage("Если системное окно установки не появилось, откройте меню браузера и выберите «Установить приложение».");
      return;
    }
    await installEvent.prompt();
    const choice = await installEvent.userChoice;
    setInstallEvent(null);
    if (choice.outcome === "dismissed") setMessage("Установка отменена. Вы сможете вернуться к ней в любой момент.");
  }

  if (installed || (!alwaysVisible && mobilePlatform !== "android" && mobilePlatform !== "ios" && !installEvent)) return null;

  return (
    <>
      <button type="button" className="p-button p-component p-button-outlined" onClick={() => void install()}>
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
      {showIosGuide ? (
        <div role="dialog" aria-modal="true" aria-labelledby="install-ios-title" style={{ background: "rgba(0, 0, 0, 0.45)", inset: 0, padding: "1rem", position: "fixed", zIndex: 1100 }}>
          <div style={{ background: "white", borderRadius: "12px", margin: "20vh auto", maxWidth: "28rem", padding: "1.5rem" }}>
            <h2 id="install-ios-title" className="mt-0">Добавить на экран «Домой»</h2>
            <p>В Safari нажмите «Поделиться», затем выберите «На экран “Домой”» и подтвердите добавление.</p>
            <button type="button" className="p-button p-component" onClick={() => setShowIosGuide(false)}><span className="p-button-label">Понятно</span></button>
          </div>
        </div>
      ) : null}
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
