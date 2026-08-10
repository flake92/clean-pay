"use server";

import { authenticateTelegramWebApp } from "@/application/auth/authenticate-telegram-webapp";
import { productionTelegramWebAppGateway } from "@/backend/integrations/auth/telegram-webapp-gateway";

export async function authenticateTelegramWebAppAction(initData: string) {
  return authenticateTelegramWebApp(productionTelegramWebAppGateway, initData);
}
