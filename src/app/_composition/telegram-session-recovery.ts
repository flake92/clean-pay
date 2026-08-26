import type { RemnashopAuthorizationOptions } from "@/backend/integrations/remnashop/session-authorization";
import type {
  RemnashopTelegramRecovery,
} from "@/backend/integrations/remnashop/telegram-session-recovery-dependency";

export const attachRemnashopTokensForTelegramSession: RemnashopTelegramRecovery = async (
  session,
) => {
  const [useCase, contract, adapter] = await Promise.all([
    import("@/application/auth/recover-telegram-session"),
    import("@/application/auth/ports/telegram-session-recovery"),
    import("@/backend/integrations/remnashop/telegram-session-recovery"),
  ]);
  try {
    return await useCase.recoverTelegramSession(
      adapter.productionTelegramSessionRecoveryGateway,
      adapter.telegramRecoverySession(session),
    );
  } catch (error) {
    if (error instanceof contract.TelegramSessionRecoveryError) {
      throw adapter.telegramRecoveryOwnershipError(error.reason);
    }
    throw error;
  }
};

export async function getAuthorizedRemnashopTokens(
  options: RemnashopAuthorizationOptions = {},
) {
  const { getAuthorizedRemnashopTokens: authorizeRemnashopTokens } = await import(
    "@/backend/integrations/remnashop/session-authorization"
  );
  return authorizeRemnashopTokens({
    ...options,
    recoverTelegramSession: attachRemnashopTokensForTelegramSession,
  });
}

export async function recoverRemnashopTelegramSession(
  sessionId: string,
  userId: string,
) {
  const { recoverRemnashopTelegramSession: recoverStoredRemnashopSession } = await import(
    "@/backend/integrations/remnashop/session-authorization"
  );
  return recoverStoredRemnashopSession(
    sessionId,
    userId,
    attachRemnashopTokensForTelegramSession,
  );
}
