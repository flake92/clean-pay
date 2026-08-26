"use server";

import { authenticateTelegramWebApp } from "@/application/auth/authenticate-telegram-webapp";
import { productionTelegramWebAppGateway } from "@/app/_composition/session-gateways";
import { clearReferralAttributionCookie } from "@/backend/integrations/referral/referral-attribution";

export async function authenticateTelegramWebAppAction(initData: string) {
  const result = await authenticateTelegramWebApp(productionTelegramWebAppGateway, initData);
  if (result.ok) await clearReferralAttributionCookie();
  return result;
}
