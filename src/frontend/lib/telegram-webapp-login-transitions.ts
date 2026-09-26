export function normalizeTelegramWebAppInitData(initData?: string) {
  const normalized = initData?.trim();
  return normalized || null;
}

export function telegramWebAppLoginErrorMessage(error: unknown) {
  return error instanceof Error
    ? error.message
    : "Не удалось войти через Telegram.";
}

export function telegramWebAppLoginProgressMessage(fallbackStarted: boolean) {
  return fallbackStarted
    ? "Открываем вход Telegram..."
    : "Входим через Telegram...";
}

export function telegramWebAppFallbackUrl(
  origin: string,
  redirectTo: string,
) {
  const url = new URL("/auth/telegram/start", origin);
  url.searchParams.set("redirect_to", redirectTo);
  return url.toString();
}
