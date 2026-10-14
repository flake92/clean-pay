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
    ? "Открываем страницу входа..."
    : "Входим через Telegram...";
}

// Without Mini App data the user continues on the login page: /auth/telegram/start
// requires a Cloudflare Turnstile token, which only the login page obtains, so a
// direct jump there is always rejected while Turnstile is enabled.
export function telegramWebAppFallbackUrl(
  origin: string,
  redirectTo: string,
) {
  const url = new URL("/login", origin);
  url.searchParams.set("redirect_to", redirectTo);
  return url.toString();
}

// "Retry" repeats the Mini App login itself (Telegram keeps its launch data for
// the session), not the browser OIDC start, which needs a Turnstile token.
export function telegramWebAppRetryPath(redirectTo: string) {
  return `/auth/telegram/webapp?redirect_to=${encodeURIComponent(redirectTo)}`;
}
