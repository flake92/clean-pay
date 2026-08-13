import type { TelegramWebAppGateway } from "@/application/auth/ports/telegram-webapp";

export type TelegramWebAppResult = { ok: true } | { ok: false; code: string; message: string };

const MAX_TELEGRAM_INIT_DATA_LENGTH = 16_384;

class TelegramWebAppWorkflowError extends Error {
  constructor(public readonly code: "UNAUTHORIZED" | "INTERNAL_ERROR") {
    super(code);
  }
}

export async function authenticateTelegramWebApp(
  gateway: TelegramWebAppGateway,
  initData: unknown,
): Promise<TelegramWebAppResult> {
  if (typeof initData !== "string" || initData.length > MAX_TELEGRAM_INIT_DATA_LENGTH) {
    return { ok: false, code: "VALIDATION_ERROR", message: "Telegram WebApp не передал данные авторизации." };
  }
  const normalizedInitData = initData.trim();
  if (!normalizedInitData) {
    return { ok: false, code: "VALIDATION_ERROR", message: "Telegram WebApp не передал данные авторизации." };
  }

  let createdSession: { id: string; userId: string } | null = null;
  try {
    await gateway.preflightCapacity();
    const providerSession = await gateway.withUpstreamConcurrency(
      "telegram_webapp_provider",
      () => gateway.authenticateProvider(normalizedInitData),
    );
    const verifiedIdentity = await gateway.withUpstreamConcurrency(
      "telegram_webapp_provider",
      () => gateway.verifiedIdentity(providerSession),
    );
    if (!verifiedIdentity.telegramId) throw new TelegramWebAppWorkflowError("UNAUTHORIZED");
    await gateway.rateLimit(verifiedIdentity.telegramId);

    const reconciled = await gateway.reconcileIdentity(providerSession, verifiedIdentity);
    if (!reconciled.upstreamSession) throw new TelegramWebAppWorkflowError("INTERNAL_ERROR");
    const session = await gateway.createSession({
      userId: reconciled.userId,
      upstreamSession: reconciled.upstreamSession,
    });
    if (!session) throw new TelegramWebAppWorkflowError("INTERNAL_ERROR");
    createdSession = { id: session.id, userId: reconciled.userId };
    if (reconciled.requiresRecovery) {
      await gateway.withUpstreamConcurrency(
        "telegram_webapp_provider",
        () => gateway.recoverSession(session.id, reconciled.userId),
      );
    }
    return { ok: true };
  } catch (error) {
    if (createdSession) {
      try {
        await gateway.revokeSession(createdSession.id, createdSession.userId);
      } catch {
        // Preserve the original workflow failure while still attempting exact
        // compensation for the newly-created session.
      }
      try {
        await gateway.clearSessionCookies();
      } catch {
        // Preserve the original failure; DB revocation remains authoritative.
      }
    }
    const code = error instanceof TelegramWebAppWorkflowError
      ? error.code
      : typeof (error as { code?: unknown })?.code === "string"
        ? String((error as { code: string }).code)
        : "INTERNAL_ERROR";
    return { ok: false, code, message: "Не удалось войти через Telegram." };
  }
}
