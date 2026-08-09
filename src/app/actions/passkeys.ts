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
import { productionPasskeyCommands } from "@/backend/integrations/auth/passkey-commands";

export async function beginPasskeyLoginAction(input: { email: string; turnstileToken?: string }) {
  return beginPasskeyLogin(productionPasskeyCommands, input) as Promise<
    | { ok: true; options: PublicKeyCredentialRequestOptionsJSON }
    | { ok: false; code: string; message: string }
  >;
}

export async function verifyPasskeyLoginAction(response: AuthenticationResponseJSON) {
  return verifyPasskeyLogin(productionPasskeyCommands, response);
}

export async function beginPasskeyRegistrationAction() {
  return beginPasskeyRegistration(productionPasskeyCommands) as Promise<
    | { ok: true; options: PublicKeyCredentialCreationOptionsJSON }
    | { ok: false; code: string; message: string }
  >;
}

export async function verifyPasskeyRegistrationAction(response: RegistrationResponseJSON & { name?: string }) {
  return verifyPasskeyRegistration(productionPasskeyCommands, response);
}
