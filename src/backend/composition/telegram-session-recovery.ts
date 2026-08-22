import { recoverTelegramSession } from "@/application/auth/recover-telegram-session";
import { TelegramSessionRecoveryError } from "@/application/auth/ports/telegram-session-recovery";
import {
  productionTelegramSessionRecoveryGateway,
  telegramRecoveryOwnershipError,
  telegramRecoverySession,
} from "@/backend/integrations/remnashop/telegram-session-recovery";
import { getCurrentSession } from "@/backend/integrations/sessions/web-session-service";

type CurrentSession = NonNullable<Awaited<ReturnType<typeof getCurrentSession>>>;

export async function attachRemnashopTokensForTelegramSession(session: CurrentSession) {
  try {
    return await recoverTelegramSession(
      productionTelegramSessionRecoveryGateway,
      telegramRecoverySession(session),
    );
  } catch (error) {
    if (error instanceof TelegramSessionRecoveryError) {
      throw telegramRecoveryOwnershipError(error.reason);
    }
    throw error;
  }
}
