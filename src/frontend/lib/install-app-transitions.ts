export function isAppleMobilePlatform(
  userAgent: string,
  maxTouchPoints: number,
) {
  return /iPad|iPhone|iPod/.test(userAgent)
    || (userAgent.includes("Mac") && maxTouchPoints > 1);
}

export function isAndroidPlatform(userAgent: string) {
  return /Android/i.test(userAgent);
}

export function isEmbeddedMobileUserAgent(userAgent: string) {
  return /Telegram|FBAN|FBAV|Instagram|Line\/|; wv\)|\bwv\b/i.test(
    userAgent,
  );
}

export function androidInstallBrowserName(userAgent: string) {
  if (/SamsungBrowser/i.test(userAgent)) return "Samsung Internet";
  if (/YaBrowser/i.test(userAgent)) return "Яндекс Браузер";
  if (/OPR|Opera/i.test(userAgent)) return "Opera";
  if (/Firefox/i.test(userAgent)) return "Firefox";
  return "браузер";
}

export function isStandaloneInstallMode(
  displayModeStandalone: boolean,
  readNavigatorStandalone: () => boolean,
) {
  return displayModeStandalone || readNavigatorStandalone();
}
