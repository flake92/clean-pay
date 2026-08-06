import type { TelegramWebAppAuthenticator } from "@/backend/application/auth/ports/telegram-webapp";

export type TelegramWebAppResult = { ok: true } | { ok: false; code: string; message: string };

export async function authenticateTelegramWebApp(
  authenticator: TelegramWebAppAuthenticator,
  initData: string,
): Promise<TelegramWebAppResult> {
  if (!initData.trim()) return { ok: false, code: "VALIDATION_ERROR", message: "Telegram WebApp не передал данные авторизации." };
  try { await authenticator.authenticate(initData.trim()); return { ok: true }; }
  catch (error) {
    const code = typeof (error as { code?: unknown })?.code === "string" ? String((error as { code: string }).code) : "INTERNAL_ERROR";
    return { ok: false, code, message: "Не удалось войти через Telegram." };
  }
}
