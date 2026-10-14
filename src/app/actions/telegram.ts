"use server";

import { authenticateTelegramWebApp } from "@/application/auth/authenticate-telegram-webapp";
import { productionTelegramWebAppGateway } from "@/app/_composition/session-gateways";
import { clearReferralAttributionCookie } from "@/app/_composition/action-runtime";
import { logTechnicalWarning } from "@/app/_composition/platform-runtime";

export async function authenticateTelegramWebAppAction(initData: string) {
  const result = await authenticateTelegramWebApp(productionTelegramWebAppGateway, initData);
  if (result.ok) await clearReferralAttributionCookie();
  // The user only sees a generic message; keep the workflow code for support.
  else logTechnicalWarning("telegram_webapp_login_failed", { code: result.code });
  return result;
}
