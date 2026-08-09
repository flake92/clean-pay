import type {
  TelegramCallbackInput,
  TelegramCallbackOutcome,
  TelegramCallbackProcessor,
} from "@/backend/application/auth/ports/telegram-callback";

export function completeTelegramCallback(
  processor: TelegramCallbackProcessor,
  input: TelegramCallbackInput,
): Promise<TelegramCallbackOutcome> {
  return processor.complete(input);
}
