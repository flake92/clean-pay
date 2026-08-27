"use server";

import type {
  AuthenticationResponseJSON,
  PublicKeyCredentialCreationOptionsJSON,
  PublicKeyCredentialRequestOptionsJSON,
  RegistrationResponseJSON,
} from "@simplewebauthn/server";

import {
  beginPasskeyLogin,
  beginPasskeyRegistration,
  verifyPasskeyLogin,
  verifyPasskeyRegistration,
} from "@/application/auth/execute-passkey-command";
import { productionPasskeyCommands } from "@/app/_composition/session-gateways";
import { clearReferralAttributionCookie } from "@/app/_composition/action-runtime";
import {
  parseAuthenticationResponsePayload,
  parsePasskeyLoginStartPayload,
  parseRegistrationResponsePayload,
} from "@/app/actions/runtime-payload";

export async function beginPasskeyLoginAction(input: { email: string; turnstileToken?: string }) {
  const parsed = parsePasskeyLoginStartPayload(input);
  if (!parsed) {
    return { ok: false as const, code: "VALIDATION_ERROR", message: "Не удалось начать быстрый вход." };
  }
  return beginPasskeyLogin(productionPasskeyCommands, parsed) as Promise<
    | { ok: true; options: PublicKeyCredentialRequestOptionsJSON }
    | { ok: false; code: string; message: string }
  >;
}

export async function verifyPasskeyLoginAction(response: AuthenticationResponseJSON) {
  const parsed = parseAuthenticationResponsePayload(response);
  if (!parsed) {
    return { ok: false as const, code: "VALIDATION_ERROR", message: "Быстрый вход не подошёл. Войдите по паролю." };
  }
  const result = await verifyPasskeyLogin(productionPasskeyCommands, parsed);
  if (result.ok) await clearReferralAttributionCookie();
  return result;
}

export async function beginPasskeyRegistrationAction() {
  return beginPasskeyRegistration(productionPasskeyCommands) as Promise<
    | { ok: true; options: PublicKeyCredentialCreationOptionsJSON }
    | { ok: false; code: string; message: string }
  >;
}

export async function verifyPasskeyRegistrationAction(response: RegistrationResponseJSON & { name?: string }) {
  const parsed = parseRegistrationResponsePayload(response);
  return parsed
    ? verifyPasskeyRegistration(productionPasskeyCommands, parsed)
    : { ok: false as const, code: "VALIDATION_ERROR", message: "Не удалось сохранить быстрый вход." };
}
