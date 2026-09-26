import { getEnv } from "@/backend/config/env";
import {
  decryptKeyringSecret,
  encryptKeyringSecret,
} from "@/backend/security/crypto";

const REMNASHOP_TOKEN_PURPOSE = "remnashop-provider-token";

export function protectRemnashopToken(token: string) {
  return encryptKeyringSecret(
    token,
    getEnv().webRefreshKeyring,
    REMNASHOP_TOKEN_PURPOSE,
  );
}

export function revealRemnashopToken(token: string) {
  return revealRemnashopTokenEnvelope(token).value;
}

export function revealRemnashopTokenEnvelope(token: string) {
  return decryptKeyringSecret(
    token,
    getEnv().webRefreshKeyring,
    REMNASHOP_TOKEN_PURPOSE,
  );
}
