import type { AuthenticationResponseJSON, RegistrationResponseJSON } from "@simplewebauthn/server";

import type { PasskeyCommands } from "@/backend/application/auth/ports/passkey-commands";
import type {
  PasskeyLoginOptionsResult,
  PasskeyRegistrationOptionsResult,
  PasskeyVerificationResult,
} from "@/shared/presentation/passkey-actions";

function failure(error: unknown, fallback: string): { ok: false; code: string; message: string } {
  const candidate = error as { code?: unknown };
  const code = typeof candidate?.code === "string" ? candidate.code : "INTERNAL_ERROR";
  if (code === "NOT_FOUND" || code === "UNAUTHORIZED") {
    return { ok: false, code, message: "Этот ключ не подходит выбранному аккаунту. Войдите по паролю и при необходимости создайте новый ключ в профиле." };
  }
  return { ok: false, code, message: fallback };
}

export async function beginPasskeyLogin(commands: PasskeyCommands, input: { email: string; turnstileToken?: string }): Promise<PasskeyLoginOptionsResult> {
  try { return { ok: true, options: await commands.beginLogin({ ...input, email: input.email.trim().toLowerCase() }) }; }
  catch (error) { return failure(error, "Не удалось начать быстрый вход."); }
}

export async function verifyPasskeyLogin(commands: PasskeyCommands, response: AuthenticationResponseJSON): Promise<PasskeyVerificationResult> {
  try { await commands.finishLogin(response); return { ok: true }; }
  catch (error) { return failure(error, "Быстрый вход не подошёл. Войдите по паролю."); }
}

export async function beginPasskeyRegistration(commands: PasskeyCommands): Promise<PasskeyRegistrationOptionsResult> {
  try { return { ok: true, options: await commands.beginRegistration() }; }
  catch (error) { return failure(error, "Не удалось подготовить быстрый вход."); }
}

export async function verifyPasskeyRegistration(
  commands: PasskeyCommands,
  response: RegistrationResponseJSON & { name?: string },
): Promise<PasskeyVerificationResult> {
  try { await commands.finishRegistration(response); return { ok: true }; }
  catch (error) { return failure(error, "Не удалось сохранить быстрый вход."); }
}
