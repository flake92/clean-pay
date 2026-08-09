import type {
  TelegramCallbackInput,
  TelegramCallbackOutcome,
  TelegramCallbackProcessor,
} from "@/application/auth/ports/telegram-callback";

export function completeTelegramCallback(
  processor: TelegramCallbackProcessor,
  input: TelegramCallbackInput,
): Promise<TelegramCallbackOutcome> {
  return processor.complete(input);
}
