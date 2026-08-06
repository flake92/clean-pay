"use server";

import { authenticateTelegramWebApp } from "@/backend/application/auth/authenticate-telegram-webapp";
import { productionTelegramWebAppAuthenticator } from "@/backend/integrations/auth/telegram-webapp";

export async function authenticateTelegramWebAppAction(initData: string) {
  return authenticateTelegramWebApp(productionTelegramWebAppAuthenticator, initData);
}
