import { getEnv } from "@/backend/config/env";
import { decryptSecret, encryptSecret } from "@/backend/security/crypto";

export function protectRemnashopToken(token: string) {
  return encryptSecret(token, getEnv().webRefreshSecret);
}

export function revealRemnashopToken(token: string) {
  return decryptSecret(token, getEnv().webRefreshSecret);
}
