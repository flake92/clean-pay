import type { TelegramSessionRecovery } from "@/application/auth/ports/telegram-session-recovery";

export function recoverTelegramSession(
  recovery: TelegramSessionRecovery,
  sessionId: string,
  userId: string,
) {
  return recovery.recover(sessionId, userId);
}
