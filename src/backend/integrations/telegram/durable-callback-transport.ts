import { getEnv } from "@/backend/config/env";
import {
  type DurableTelegramCallbackCheckpoint,
  DURABLE_TELEGRAM_CALLBACK_RESULT_MAX_BYTES,
  DURABLE_TELEGRAM_CALLBACK_RESULT_PURPOSE,
  type StoredDurableTelegramCallbackCheckpoint,
} from "@/backend/integrations/telegram/durable-callback-contract";
import {
  parseDurableTelegramCheckpointValue,
  parseStoredDurableTelegramCallbackCheckpoint,
} from "@/backend/integrations/telegram/durable-callback-decoder";
import {
  decryptKeyringSecret,
  encryptKeyringSecret,
} from "@/backend/security/crypto";

export function protectDurableTelegramStored(
  value: StoredDurableTelegramCallbackCheckpoint,
) {
  const payload = JSON.stringify(value);
  if (Buffer.byteLength(payload, "utf8") > DURABLE_TELEGRAM_CALLBACK_RESULT_MAX_BYTES) {
    throw new Error("Durable Telegram callback checkpoint is too large");
  }
  return encryptKeyringSecret(
    payload,
    getEnv().webRefreshKeyring,
    DURABLE_TELEGRAM_CALLBACK_RESULT_PURPOSE,
  );
}

export function protectDurableTelegramCheckpoint(
  phase: StoredDurableTelegramCallbackCheckpoint["phase"],
  value: unknown,
) {
  return protectDurableTelegramStored({ version: 2, phase, value });
}

export function revealDurableTelegramStored(encrypted: string) {
  const revealed = decryptKeyringSecret(
    encrypted,
    getEnv().webRefreshKeyring,
    DURABLE_TELEGRAM_CALLBACK_RESULT_PURPOSE,
  );
  const stored = parseStoredDurableTelegramCallbackCheckpoint(
    JSON.parse(revealed.value),
  );
  return { stored, revealed };
}

export function parseDurableTelegramCheckpoint(
  status: StoredDurableTelegramCallbackCheckpoint["phase"],
  encrypted: string,
): {
  checkpoint: DurableTelegramCallbackCheckpoint;
  plaintext: string;
  needsRewrap: boolean;
} {
  const { stored, revealed } = revealDurableTelegramStored(encrypted);
  if (stored.phase !== status) {
    throw new Error("Durable Telegram callback phase mismatch");
  }
  return {
    checkpoint: parseDurableTelegramCheckpointValue(status, stored.value),
    plaintext: revealed.value,
    needsRewrap: revealed.needsRewrap,
  };
}

export function rewrapDurableTelegramStored(plaintext: string) {
  return encryptKeyringSecret(
    plaintext,
    getEnv().webRefreshKeyring,
    DURABLE_TELEGRAM_CALLBACK_RESULT_PURPOSE,
  );
}
