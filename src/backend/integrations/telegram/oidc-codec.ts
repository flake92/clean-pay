import { createHash, createHmac } from "node:crypto";
import type { JWTPayload } from "jose";

import type { TelegramAuthRequest } from "@/backend/integrations/remnashop/contracts";
import { safeEqual } from "@/backend/security/crypto";

export type TelegramTokenResponse = {
  id_token?: string;
  error?: string;
  error_description?: string;
};

type TelegramPublicJwk = Record<string, string | string[]>;

export type TelegramLoginWidgetPayload = Partial<TelegramAuthRequest> & {
  hash?: string | null;
};

const telegramLoginAuthMaxAgeSeconds = 5 * 60;
const telegramLoginClockSkewSeconds = 30;

export function decodeTelegramTokenResponse(value: unknown): TelegramTokenResponse {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError("Telegram token response must be an object");
  }

  const input = value as Record<string, unknown>;
  for (const field of ["id_token", "error", "error_description"] as const) {
    if (input[field] !== undefined && typeof input[field] !== "string") {
      throw new TypeError(`Telegram token response ${field} must be a string`);
    }
  }

  return {
    ...(input.id_token === undefined ? {} : { id_token: input.id_token as string }),
    ...(input.error === undefined ? {} : { error: input.error as string }),
    ...(input.error_description === undefined
      ? {}
      : { error_description: input.error_description as string }),
  };
}

export function decodeTelegramJwks(value: unknown): { keys: TelegramPublicJwk[] } {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError("Telegram JWKS response must be an object");
  }
  const keys = (value as Record<string, unknown>).keys;
  if (!Array.isArray(keys) || keys.length === 0 || keys.length > 32) {
    throw new TypeError("Telegram JWKS response must contain 1 to 32 keys");
  }

  return {
    keys: keys.map((value, index) => {
      if (!value || typeof value !== "object" || Array.isArray(value)) {
        throw new TypeError(`Telegram JWK ${index} must be an object`);
      }
      const input = value as Record<string, unknown>;
      const stringField = (field: string, required = false) => {
        const fieldValue = input[field];
        if (fieldValue === undefined && !required) return undefined;
        if (
          typeof fieldValue !== "string"
          || fieldValue.length === 0
          || fieldValue.length > 8_192
        ) {
          throw new TypeError(`Telegram JWK ${index} ${field} is invalid`);
        }
        return fieldValue;
      };
      const kty = stringField("kty", true) as string;
      const projected: TelegramPublicJwk = { kty };
      for (const field of ["kid", "use", "alg"] as const) {
        const fieldValue = stringField(field);
        if (fieldValue !== undefined) projected[field] = fieldValue;
      }
      if (input.key_ops !== undefined) {
        if (
          !Array.isArray(input.key_ops)
          || input.key_ops.length > 16
          || input.key_ops.some((operation) =>
            typeof operation !== "string"
            || operation.length === 0
            || operation.length > 64
          )
        ) {
          throw new TypeError(`Telegram JWK ${index} key_ops is invalid`);
        }
        projected.key_ops = [...input.key_ops] as string[];
      }

      const requiredFields = kty === "RSA"
        ? ["n", "e"]
        : kty === "EC"
          ? ["crv", "x", "y"]
          : kty === "OKP"
            ? ["crv", "x"]
            : null;
      if (!requiredFields) {
        throw new TypeError(`Telegram JWK ${index} kty is unsupported`);
      }
      for (const field of requiredFields) {
        projected[field] = stringField(field, true) as string;
      }
      return projected;
    }),
  };
}

export function normalizeTelegramOidcClientSecret(
  clientId: string,
  clientSecret: string,
) {
  const tokenPrefix = `${clientId}:`;
  return clientSecret.startsWith(tokenPrefix)
    ? clientSecret.slice(tokenPrefix.length)
    : clientSecret;
}

export function getTelegramId(payload: JWTPayload) {
  const rawTelegramId = payload.id ?? payload.telegram_id;

  if (
    typeof rawTelegramId !== "string"
    && typeof rawTelegramId !== "number"
  ) {
    throw new Error("Telegram id_token does not contain Telegram user id");
  }

  const telegramId = BigInt(rawTelegramId);
  if (telegramId <= BigInt(0)) {
    throw new Error("Telegram id_token contains invalid telegram_id");
  }

  return telegramId.toString();
}

export function getTelegramFullName(payload: JWTPayload) {
  if (typeof payload.name === "string") {
    return payload.name;
  }

  const parts = [payload.given_name, payload.family_name].filter(
    (part): part is string => typeof part === "string" && part.length > 0,
  );
  return parts.length > 0 ? parts.join(" ") : null;
}

export function signTelegramAuthPayload(
  body: Omit<TelegramAuthRequest, "hash">,
  botToken: string,
) {
  const dataCheckString = Object.entries(body)
    .filter(([, value]) => value !== undefined && value !== null && value !== "")
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, value]) => `${key}=${value}`)
    .join("\n");
  const secret = createHash("sha256").update(botToken).digest();
  return createHmac("sha256", secret).update(dataCheckString).digest("hex");
}

export function verifyTelegramLoginWidgetPayload(
  payload: TelegramLoginWidgetPayload,
  options: {
    botToken: string | null | undefined;
    nowEpochSeconds: number;
  },
) {
  if (!options.botToken) {
    throw new Error("TELEGRAM_BOT_TOKEN is required for Telegram Login widget");
  }
  const hash = payload.hash;
  if (!hash) {
    throw new Error("Telegram Login payload does not contain hash");
  }
  if (!payload.id || !payload.auth_date) {
    throw new Error("Telegram Login payload is incomplete");
  }

  const authDate = Number(payload.auth_date);
  if (!Number.isFinite(authDate) || authDate <= 0) {
    throw new Error("Telegram Login payload contains invalid auth_date");
  }
  if (
    authDate - options.nowEpochSeconds > telegramLoginClockSkewSeconds
    || options.nowEpochSeconds - authDate > telegramLoginAuthMaxAgeSeconds
  ) {
    throw new Error("Telegram Login payload is expired");
  }

  const bodyWithoutHash: Omit<TelegramAuthRequest, "hash"> = {
    id: Number(payload.id),
    first_name: payload.first_name ?? "Telegram",
    last_name: payload.last_name,
    username: payload.username,
    photo_url: payload.photo_url,
    auth_date: authDate,
  };
  const expectedHash = signTelegramAuthPayload(bodyWithoutHash, options.botToken);
  if (!safeEqual(expectedHash, hash)) {
    throw new Error("Telegram Login payload hash is invalid");
  }

  return {
    ...bodyWithoutHash,
    hash,
  };
}

export function telegramWidgetReplayTtlSeconds(
  authDate: number,
  nowEpochSeconds: number,
) {
  const ageSeconds = Math.max(0, nowEpochSeconds - authDate);
  return Math.max(1, telegramLoginAuthMaxAgeSeconds - ageSeconds);
}
