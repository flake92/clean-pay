import type { TelegramSessionRecovery } from "@/application/auth/ports/telegram-session-recovery";
import { recoverRemnashopTelegramSession } from "@/backend/integrations/remnashop/client";

export const productionTelegramSessionRecovery: TelegramSessionRecovery = {
  async recover(sessionId, userId) {
    await recoverRemnashopTelegramSession(sessionId, userId);
  },
};
