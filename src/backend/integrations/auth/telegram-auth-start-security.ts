import type {
  TelegramAuthStartSecurity,
} from "@/application/auth/ports/telegram-auth-start";
import { getCurrentUser } from "@/backend/integrations/sessions/web-session-service";
import { assertRateLimit } from "@/backend/limits/rate-limit";
import { verifyTurnstileToken } from "@/backend/security/turnstile";

export const productionTelegramAuthStartSecurity: TelegramAuthStartSecurity = {
  loadCurrentUser: getCurrentUser,
  verifyHuman: verifyTurnstileToken,
  assertLinkRateLimit(user) {
    return assertRateLimit({
      action: "telegram_link_start",
      email: user.email,
      tgId: user.telegramId,
      limit: 10,
      windowSeconds: 15 * 60,
    });
  },
};
