import { createProductionTelegramAuthStartSecurity } from "@/backend/integrations/auth/telegram-auth-start-security";

export {
  createTelegramAuthorizationResponse,
  createTelegramPopupStartResponse,
} from "@/backend/integrations/telegram/oidc";

export const productionTelegramAuthStartSecurity =
  createProductionTelegramAuthStartSecurity();
