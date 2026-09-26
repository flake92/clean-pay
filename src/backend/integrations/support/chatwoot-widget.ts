import { createHmac } from "node:crypto";

import type { ChatwootWidgetConfig } from "@/application/models/chatwoot";
import type { SupportWidgetIdentity } from "@/application/models/navigation";
import { getEnv } from "@/backend/config/env";

const identityFingerprintKeyDomain = "clean-pay/chatwoot/identity-fingerprint-key/v1";
const identityFingerprintPayloadDomain = "clean-pay/chatwoot/identity-fingerprint/v1";

function normalizedName(value: string | null) {
  const name = value?.trim();

  return name ? name.slice(0, 255) : null;
}

function displayName(identity: SupportWidgetIdentity) {
  return normalizedName(identity.displayName)
    ?? normalizedName(identity.fullName)
    ?? (normalizedName(identity.telegramUsername)
      ? `@${normalizedName(identity.telegramUsername)!.replace(/^@/, "")}`
      : null)
    ?? `Пользователь ${identity.userId.slice(-8)}`;
}

export function createChatwootWidgetConfig(
  identity: SupportWidgetIdentity | null,
): ChatwootWidgetConfig | null {
  const chatwoot = getEnv().chatwoot;

  if (!identity || !chatwoot) {
    return null;
  }

  const customAttributes: Record<string, string> = {
    clean_pay_user_id: identity.userId,
    telegram_id: identity.telegramId ?? "",
    telegram_username: identity.telegramUsername?.replace(/^@/, "") ?? "",
  };
  const name = displayName(identity);
  const email = identity.emailVerified ? identity.email : null;
  const identifierHash = createHmac("sha256", chatwoot.hmacToken)
    .update(identity.userId, "utf8")
    .digest("hex");
  const fingerprintKey = createHmac("sha256", chatwoot.hmacToken)
    .update(identityFingerprintKeyDomain, "utf8")
    .digest();
  const identityFingerprint = createHmac("sha256", fingerprintKey)
    .update(JSON.stringify([
      identityFingerprintPayloadDomain,
      chatwoot.baseUrl,
      chatwoot.websiteToken,
      identity.userId,
      identifierHash,
      name,
      email,
      Object.entries(customAttributes).sort(([left], [right]) => (
        left < right ? -1 : left > right ? 1 : 0
      )),
    ]), "utf8")
    .digest("hex");

  return {
    baseUrl: chatwoot.baseUrl,
    identityFingerprint,
    websiteToken: chatwoot.websiteToken,
    user: {
      identifier: identity.userId,
      identifierHash,
      name,
      // Chatwoot can merge contacts by e-mail. Never let an unverified local
      // address claim an existing support contact.
      email,
      customAttributes,
    },
  };
}
