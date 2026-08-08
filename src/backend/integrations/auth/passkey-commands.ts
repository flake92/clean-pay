import type { PasskeyCommands } from "@/backend/application/auth/ports/passkey-commands";
import {
  beginPasskeyLogin,
  beginPasskeyRegistration,
  finishPasskeyLogin,
  finishPasskeyRegistration,
} from "@/backend/integrations/auth/passkey-service";
import { verifyTurnstileToken } from "@/backend/security/turnstile";

export const productionPasskeyCommands: PasskeyCommands = {
  async beginLogin(input) {
    await verifyTurnstileToken(input.turnstileToken ?? null, "auth_login");
    return beginPasskeyLogin(input.email);
  },
  finishLogin: async (response) => { await finishPasskeyLogin(response); },
  beginRegistration: beginPasskeyRegistration,
  finishRegistration: async (response) => { await finishPasskeyRegistration(response); },
};
