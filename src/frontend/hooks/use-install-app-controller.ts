"use client";

import { useEffect, useRef, useState } from "react";

import {
  embeddedInstallPageUrl,
  failedInstallPromptMessage,
  missingInstallPromptMessage,
  selectEmbeddedInstallBrowser,
  selectInstallMobilePlatform,
  shouldAutoOpenIosInstallGuide,
  type InstallMobilePlatform,
} from "@/frontend/components/install-app-button-state";
import {
  androidInstallBrowserName,
  isAndroidPlatform,
  isAppleMobilePlatform,
  isStandaloneInstallMode,
} from "@/frontend/lib/install-app-transitions";
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
  return isAppleMobilePlatform(
    navigator.userAgent,
    navigator.maxTouchPoints,
  );
}

function isAndroidDevice() {
  if (typeof navigator === "undefined") return false;
  return isAndroidPlatform(navigator.userAgent);
}

function isEmbeddedMobileBrowser() {
  if (typeof navigator === "undefined") return false;

  const openedInTelegramWebApp = wasOpenedInTelegramWebApp();
  return selectEmbeddedInstallBrowser(
    openedInTelegramWebApp,
    openedInTelegramWebApp ? "" : navigator.userAgent,
  );
}

function androidBrowserName() {
  return androidInstallBrowserName(navigator.userAgent);
}

function isStandalone() {
  return isStandaloneInstallMode(
    window.matchMedia("(display-mode: standalone)").matches,
    () =>
      "standalone" in navigator
      && (navigator as Navigator & { standalone?: boolean }).standalone === true,
  );
}

function currentMobilePlatform(): InstallMobilePlatform {
  const iosDevice = isAppleMobileDevice();
  return selectInstallMobilePlatform(
    iosDevice,
    !iosDevice && isAndroidDevice(),
  );
}

export function useInstallAppController({
  autoOpenIosGuide,
}: {
  autoOpenIosGuide: boolean;
}) {
  const [installEvent, setInstallEvent] =
    useState<BeforeInstallPromptEvent | null>(null);
  const [showIosGuide, setShowIosGuide] = useState(false);
  const [showAndroidGuide, setShowAndroidGuide] = useState(false);
  const [showEmbeddedGuide, setShowEmbeddedGuide] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [installed, setInstalled] = useState(false);
  const [mobilePlatform, setMobilePlatform] =
    useState<InstallMobilePlatform | null>(null);
  const [embeddedBrowser, setEmbeddedBrowser] = useState(false);
  const [installPending, setInstallPending] = useState(false);
  const installPendingRef = useRef(false);

  useEffect(() => {
    const platformTimer = window.setTimeout(() => {
      const isIos = isAppleMobileDevice();
      const requestedPlatform = new URLSearchParams(window.location.search).get(
        "platform",
      );
      setInstalled((current) => current || isStandalone());
      setMobilePlatform(selectInstallMobilePlatform(
        isIos,
        !isIos && isAndroidDevice(),
      ));
      const embedded = isEmbeddedMobileBrowser();
      setEmbeddedBrowser(embedded);

      const guideCandidate = autoOpenIosGuide
        && (isIos || requestedPlatform === "ios")
        && !embedded;
      if (shouldAutoOpenIosInstallGuide({
        autoOpenIosGuide,
        embeddedBrowser: embedded,
        iosDevice: isIos,
        requestedPlatform,
        standalone: guideCandidate ? isStandalone() : false,
      })) {
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

    return () => {
      window.clearTimeout(platformTimer);
      window.removeEventListener("beforeinstallprompt", onBeforeInstallPrompt);
      window.removeEventListener("appinstalled", onInstalled);
    };
  }, [autoOpenIosGuide]);

  function openExternalInstallPage() {
    const installUrl = embeddedInstallPageUrl(
      window.location.origin,
      currentMobilePlatform(),
    );

    if (!openTelegramExternalLink(installUrl)) {
      setShowEmbeddedGuide(true);
    }
  }

  async function install() {
    if (installPendingRef.current) return;
    setMessage(null);
    if (embeddedBrowser) {
      openExternalInstallPage();
      return;
    }
    if (isAppleMobileDevice()) {
      setShowIosGuide(true);
      return;
    }
    if (!installEvent && isAndroidDevice()) {
      setShowAndroidGuide(true);
      return;
    }
    if (!installEvent) {
      setMessage(missingInstallPromptMessage());
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
      setMessage(failedInstallPromptMessage());
    } finally {
      installPendingRef.current = false;
      setInstallPending(false);
    }
  }

  return {
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
  };
}
