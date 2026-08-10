import type { TelegramWebAppGateway } from "@/application/auth/ports/telegram-webapp";

export type TelegramWebAppResult = { ok: true } | { ok: false; code: string; message: string };

class TelegramWebAppWorkflowError extends Error {
  constructor(public readonly code: "UNAUTHORIZED" | "INTERNAL_ERROR") {
    super(code);
  }
}

export async function authenticateTelegramWebApp(
  gateway: TelegramWebAppGateway,
  initData: string,
): Promise<TelegramWebAppResult> {
  if (!initData.trim()) {
    return { ok: false, code: "VALIDATION_ERROR", message: "Telegram WebApp не передал данные авторизации." };
  }

  try {
    const providerSession = await gateway.authenticateProvider(initData.trim());
    const verifiedIdentity = await gateway.verifiedIdentity(providerSession);
    if (!verifiedIdentity.telegramId) throw new TelegramWebAppWorkflowError("UNAUTHORIZED");
    await gateway.rateLimit(verifiedIdentity.telegramId);

    const reconciled = await gateway.reconcileIdentity(providerSession, verifiedIdentity);
    if (!reconciled.upstreamSession) throw new TelegramWebAppWorkflowError("INTERNAL_ERROR");
    const session = await gateway.createSession({
      userId: reconciled.userId,
      upstreamSession: reconciled.upstreamSession,
    });
    if (!session) throw new TelegramWebAppWorkflowError("INTERNAL_ERROR");
    if (reconciled.requiresRecovery) {
      await gateway.recoverSession(session.id, reconciled.userId);
    }
    return { ok: true };
  } catch (error) {
    const code = error instanceof TelegramWebAppWorkflowError
      ? error.code
      : typeof (error as { code?: unknown })?.code === "string"
        ? String((error as { code: string }).code)
        : "INTERNAL_ERROR";
    return { ok: false, code, message: "Не удалось войти через Telegram." };
  }
}
