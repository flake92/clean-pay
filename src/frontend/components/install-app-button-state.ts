import {
  isEmbeddedMobileUserAgent,
} from "@/frontend/lib/install-app-transitions";

export type InstallMobilePlatform = "android" | "ios" | "other";

export function selectInstallMobilePlatform(
  iosDevice: boolean,
  androidDevice: boolean,
): InstallMobilePlatform {
  if (iosDevice) return "ios";
  if (androidDevice) return "android";
  return "other";
}

export function selectEmbeddedInstallBrowser(
  openedInTelegramWebApp: boolean,
  userAgent: string,
) {
  return openedInTelegramWebApp || isEmbeddedMobileUserAgent(userAgent);
}

export function shouldAutoOpenIosInstallGuide({
  autoOpenIosGuide,
  embeddedBrowser,
  iosDevice,
  requestedPlatform,
  standalone,
}: {
  autoOpenIosGuide: boolean;
  embeddedBrowser: boolean;
  iosDevice: boolean;
  requestedPlatform: string | null;
  standalone: boolean;
}) {
  return autoOpenIosGuide
    && (iosDevice || requestedPlatform === "ios")
    && !embeddedBrowser
    && !standalone;
}

export function embeddedInstallPageUrl(
  origin: string,
  platform: InstallMobilePlatform,
) {
  const installUrl = new URL("/install", origin);
  installUrl.searchParams.set("source", "telegram");
  installUrl.searchParams.set("platform", platform);
  return installUrl.toString();
}

export function missingInstallPromptMessage() {
  return "Если системное окно установки не появилось, откройте меню браузера и выберите «Установить приложение».";
}

export function failedInstallPromptMessage() {
  return "Не удалось открыть системное окно установки. Попробуйте ещё раз через меню браузера.";
}
