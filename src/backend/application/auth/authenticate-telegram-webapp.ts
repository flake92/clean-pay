import type { TelegramWebAppAuthenticator } from "@/backend/application/auth/ports/telegram-webapp";
import { ServiceError } from "@/backend/errors/service-error";

export type TelegramWebAppResult = { ok: true } | { ok: false; code: string; message: string };

export async function authenticateTelegramWebApp(
  authenticator: TelegramWebAppAuthenticator,
  initData: string,
): Promise<TelegramWebAppResult> {
  if (!initData.trim()) return { ok: false, code: "VALIDATION_ERROR", message: "Telegram WebApp не передал данные авторизации." };
  try { await authenticator.authenticate(initData.trim()); return { ok: true }; }
  catch (error) {
    const code = error instanceof ServiceError ? error.code : "INTERNAL_ERROR";
    const message = error instanceof ServiceError ? error.prodMessage : "Не удалось войти через Telegram.";
    return { ok: false, code, message };
  }
}
