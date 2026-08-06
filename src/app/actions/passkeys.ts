"use server";

import type { AuthenticationResponseJSON, RegistrationResponseJSON } from "@simplewebauthn/server";

import {
  beginPasskeyLogin,
  beginPasskeyRegistration,
  verifyPasskeyLogin,
  verifyPasskeyRegistration,
} from "@/backend/application/auth/execute-passkey-command";
import { productionPasskeyCommands } from "@/backend/integrations/auth/passkey-commands";

export async function beginPasskeyLoginAction(input: { email: string; turnstileToken?: string }) {
  return beginPasskeyLogin(productionPasskeyCommands, input);
}

export async function verifyPasskeyLoginAction(response: AuthenticationResponseJSON) {
  return verifyPasskeyLogin(productionPasskeyCommands, response);
}

export async function beginPasskeyRegistrationAction() {
  return beginPasskeyRegistration(productionPasskeyCommands);
}

export async function verifyPasskeyRegistrationAction(response: RegistrationResponseJSON & { name?: string }) {
  return verifyPasskeyRegistration(productionPasskeyCommands, response);
}
