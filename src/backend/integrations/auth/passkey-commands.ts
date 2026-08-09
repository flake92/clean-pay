import type { PasskeyCommands } from "@/application/auth/ports/passkey-commands";
import type {
  AuthenticationResponseJSON,
  RegistrationResponseJSON,
} from "@simplewebauthn/server";
import {
  beginPasskeyLogin,
  beginPasskeyRegistration,
  finishPasskeyLogin,
  finishPasskeyRegistration,
} from "@/backend/integrations/auth/passkey-service";
import { verifyTurnstileToken } from "@/backend/security/turnstile";

export const productionPasskeyCommands: PasskeyCommands = {
  verifyHuman: (token) => verifyTurnstileToken(token, "auth_login"),
  beginLogin: (email) => beginPasskeyLogin(email),
  finishLogin: async (response) => {
    await finishPasskeyLogin(response as AuthenticationResponseJSON);
  },
  beginRegistration: beginPasskeyRegistration,
  finishRegistration: async (response) => {
    await finishPasskeyRegistration(response as RegistrationResponseJSON & { name?: string });
  },
};
