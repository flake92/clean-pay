"use client";

import { useEffect, useState } from "react";

type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
};

function isAppleMobileDevice() {
  return /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.userAgent.includes("Mac") && navigator.maxTouchPoints > 1);
}

function isStandalone() {
  return window.matchMedia("(display-mode: standalone)").matches || ("standalone" in navigator && (navigator as Navigator & { standalone?: boolean }).standalone === true);
}

export function InstallAppButton() {
  const [installEvent, setInstallEvent] = useState<BeforeInstallPromptEvent | null>(null);
  const [showIosGuide, setShowIosGuide] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [installed, setInstalled] = useState(() => typeof window !== "undefined" && isStandalone());

  useEffect(() => {
    const onBeforeInstallPrompt = (event: Event) => { event.preventDefault(); setInstallEvent(event as BeforeInstallPromptEvent); };
    const onInstalled = () => setInstalled(true);
    window.addEventListener("beforeinstallprompt", onBeforeInstallPrompt);
    window.addEventListener("appinstalled", onInstalled);
    return () => { window.removeEventListener("beforeinstallprompt", onBeforeInstallPrompt); window.removeEventListener("appinstalled", onInstalled); };
  }, []);

  async function install() {
    setMessage(null);
    if (isAppleMobileDevice()) { setShowIosGuide(true); return; }
    if (!installEvent) { setMessage("Откройте кабинет в Chrome на Android и выберите «Установить приложение» в меню браузера."); return; }
    await installEvent.prompt();
    const choice = await installEvent.userChoice;
    setInstallEvent(null);
    if (choice.outcome === "dismissed") setMessage("Установка отменена. Вы сможете вернуться к ней в любой момент.");
  }

  if (installed) return null;

  return (
    <>
      <button type="button" className="p-button p-component p-button-outlined" onClick={() => void install()}>
        <span className="p-button-icon p-c pi pi-mobile" />
        <span className="p-button-label">Установить приложение</span>
      </button>
      {message ? <p className="m-0 text-sm text-600">{message}</p> : null}
      {showIosGuide ? (
        <div role="dialog" aria-modal="true" aria-labelledby="install-ios-title" style={{ background: "rgba(0, 0, 0, 0.45)", inset: 0, padding: "1rem", position: "fixed", zIndex: 1100 }}>
          <div style={{ background: "white", borderRadius: "12px", margin: "20vh auto", maxWidth: "28rem", padding: "1.5rem" }}>
            <h2 id="install-ios-title" className="mt-0">Добавить на экран «Домой»</h2>
            <p>В Safari нажмите «Поделиться», затем выберите «На экран “Домой”» и подтвердите добавление.</p>
            <button type="button" className="p-button p-component" onClick={() => setShowIosGuide(false)}><span className="p-button-label">Понятно</span></button>
          </div>
        </div>
      ) : null}
    </>
  );
}
