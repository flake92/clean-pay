import type {
  TelegramAuthStartSecurity,
} from "@/backend/application/auth/ports/telegram-auth-start";

export class TelegramAuthStartFailure extends Error {
  constructor(
    public readonly authenticated: boolean,
    public readonly cause: unknown,
  ) {
    super("Telegram authentication start failed", { cause });
    this.name = "TelegramAuthStartFailure";
  }
}

export async function prepareTelegramAuthStart(
  security: TelegramAuthStartSecurity,
  input: { turnstileToken: string | null },
) {
  let currentUser: Awaited<ReturnType<TelegramAuthStartSecurity["loadCurrentUser"]>> = null;

  try {
    currentUser = await security.loadCurrentUser();
    await security.verifyHuman(
      input.turnstileToken,
      currentUser ? "telegram_auth_start" : "auth_login",
    );

    if (currentUser) {
      await security.assertLinkRateLimit(currentUser);
    }

    return {
      authenticated: Boolean(currentUser),
      userId: currentUser?.id,
    };
  } catch (error) {
    throw new TelegramAuthStartFailure(Boolean(currentUser), error);
  }
}
