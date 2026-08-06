import type { LinkAccountCommands, LinkAccountReader } from "@/backend/application/auth/ports/link-account";
import type { LinkAccountCommandResult, LinkAccountViewModel } from "@/shared/presentation/link-account";

function callbackError(status: string | null) {
  if (status === "telegram_merge_subscriptions") return "В обеих учётных записях есть подписки. Данные не изменены — обратитесь в службу поддержки.";
  if (status === "telegram_merge_required") return "Автоматическое объединение остановлено из-за конфликта данных. Ничего не изменено.";
  if (status === "telegram_failed") return "Не удалось завершить привязку Telegram.";
  return null;
}

export async function loadLinkAccount(reader: LinkAccountReader, status: string | null): Promise<LinkAccountViewModel> {
  try {
    const [profile, passkeys, mergeConfirmation] = await Promise.all([
      reader.loadProfile(),
      reader.loadPasskeys().catch(() => []),
      status === "telegram_email_replace" || status === "telegram_processing"
        ? reader.loadTelegramMergeConfirmation()
        : Promise.resolve(null),
    ]);
    return { status: "ready", profile, passkeys, mergeConfirmation, callbackError: callbackError(status) };
  } catch (error) {
    const code = (error as { code?: unknown })?.code;
    return code === "UNAUTHORIZED"
      ? { status: "unauthorized" }
      : { status: "error", message: "Не удалось загрузить способы входа." };
  }
}

function failed(error: unknown, fallback: string): LinkAccountCommandResult {
  const code = typeof (error as { code?: unknown })?.code === "string" ? String((error as { code: string }).code) : "INTERNAL_ERROR";
  const prodMessage = typeof (error as { prodMessage?: unknown })?.prodMessage === "string" ? (error as { prodMessage: string }).prodMessage : null;
  const message = code === "AUTH_FAILED" ? "Неверный e-mail или пароль." : code === "UNAUTHORIZED" ? "Сессия завершилась. Войдите снова." : prodMessage ?? fallback;
  return { ok: false, code, message };
}

export async function linkAccountEmail(commands: LinkAccountCommands, input: { email: string; password: string }): Promise<LinkAccountCommandResult> {
  try {
    const result = await commands.linkEmail({ email: input.email.trim().toLowerCase(), password: input.password });
    return { ok: true, kind: result.linked ? "linked" : "verification-required" };
  } catch (error) { return failed(error, "Не удалось связать e-mail с аккаунтом."); }
}

export async function confirmLinkedTelegram(commands: LinkAccountCommands): Promise<LinkAccountCommandResult> {
  try { await commands.confirmTelegramMerge(); return { ok: true, kind: "merge-confirmed" }; }
  catch (error) { return failed(error, "Не удалось объединить аккаунты."); }
}

export async function cancelLinkedTelegram(commands: LinkAccountCommands): Promise<LinkAccountCommandResult> {
  try { await commands.cancelTelegramMerge(); return { ok: true, kind: "merge-cancelled" }; }
  catch (error) { return failed(error, "Не удалось отменить объединение."); }
}

export async function removeLinkedPasskey(commands: LinkAccountCommands, id: string): Promise<LinkAccountCommandResult> {
  try { await commands.deletePasskey(id); return { ok: true, kind: "passkey-deleted" }; }
  catch (error) { return failed(error, "Не удалось удалить ключ быстрого входа."); }
}
