import {
  createCipheriv,
  createDecipheriv,
  createHash,
  createHmac,
  randomBytes,
  timingSafeEqual,
} from "node:crypto";

export function randomToken(bytes = 32) {
  return randomBytes(bytes).toString("base64url");
}

export function sha256(value: string) {
  return createHash("sha256").update(value).digest("base64url");
}

export function hmacSha256(value: string, secret: string) {
  return createHmac("sha256", secret).update(value).digest("base64url");
}

export function safeEqual(left: string, right: string) {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);

  return (
    leftBuffer.length === rightBuffer.length &&
    timingSafeEqual(leftBuffer, rightBuffer)
  );
}

export function jsonBase64Url(value: unknown) {
  return Buffer.from(JSON.stringify(value)).toString("base64url");
}

export function parseJsonBase64Url<T>(value: string) {
  return JSON.parse(Buffer.from(value, "base64url").toString("utf8")) as T;
}

function encryptionKey(secret: string) {
  return createHash("sha256").update(secret).digest();
}

export type SecretEncryptionKeyring = {
  primary: { id: string; secret: string };
  previous: readonly { id: string; secret: string }[];
};

export type DecryptedKeyringSecret = {
  value: string;
  keyId: string;
  needsRewrap: boolean;
};

function purposeEncryptionKey(secret: string, purpose: string) {
  return createHmac("sha256", secret)
    .update(`clean-pay:secret-encryption:v1:${purpose}`)
    .digest();
}

export function secretEncryptionKeyCommitment(secret: string) {
  return createHmac("sha256", secret)
    .update("clean-pay:secret-encryption:key-binding:v2")
    .digest("base64url")
    .slice(0, 22);
}

function decryptVersionedEnvelope(
  encrypted: string,
  iv: string,
  authTag: string,
  secret: string,
  purpose: string,
  associatedData: string,
) {
  const decipher = createDecipheriv(
    "aes-256-gcm",
    purposeEncryptionKey(secret, purpose),
    Buffer.from(iv, "base64url"),
  );
  decipher.setAAD(Buffer.from(associatedData, "utf8"));
  decipher.setAuthTag(Buffer.from(authTag, "base64url"));
  return Buffer.concat([
    decipher.update(Buffer.from(encrypted, "base64url")),
    decipher.final(),
  ]).toString("utf8");
}

export function encryptKeyringSecret(
  value: string,
  keyring: SecretEncryptionKeyring,
  purpose: string,
) {
  const iv = randomBytes(12);
  const prefix = [
    "v2",
    keyring.primary.id,
    secretEncryptionKeyCommitment(keyring.primary.secret),
  ].join(".");
  const cipher = createCipheriv(
    "aes-256-gcm",
    purposeEncryptionKey(keyring.primary.secret, purpose),
    iv,
  );
  cipher.setAAD(Buffer.from(`${prefix}.${purpose}`, "utf8"));
  const encrypted = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  const authTag = cipher.getAuthTag();

  return [
    prefix,
    iv.toString("base64url"),
    authTag.toString("base64url"),
    encrypted.toString("base64url"),
  ].join(".");
}

export function decryptKeyringSecret(
  value: string,
  keyring: SecretEncryptionKeyring,
  purpose: string,
): DecryptedKeyringSecret {
  const parts = value.split(".");

  if (parts.length === 6 && parts[0] === "v2") {
    const [, keyId, commitment, iv, authTag, encrypted] = parts;
    const entries = [keyring.primary, ...keyring.previous];
    const entryIndex = keyId && commitment
      ? entries.findIndex((entry) =>
          entry.id === keyId
          && secretEncryptionKeyCommitment(entry.secret) === commitment
        )
      : -1;
    const entry = entryIndex >= 0 ? entries[entryIndex] : undefined;
    if (!entry || !keyId || !commitment || !iv || !authTag || !encrypted) {
      throw new Error("Unknown or invalid encrypted secret key");
    }
    return {
      value: decryptVersionedEnvelope(
        encrypted,
        iv,
        authTag,
        entry.secret,
        purpose,
        `v2.${keyId}.${commitment}.${purpose}`,
      ),
      keyId,
      needsRewrap: entryIndex !== 0,
    };
  }

  if (parts.length === 5 && parts[0] === "v1") {
    const [, keyId, iv, authTag, encrypted] = parts;
    if (!keyId || !iv || !authTag || !encrypted) {
      throw new Error("Unknown or invalid encrypted secret key");
    }
    for (const entry of [keyring.primary, ...keyring.previous]) {
      if (entry.id !== keyId) continue;
      try {
        return {
          value: decryptVersionedEnvelope(
            encrypted,
            iv,
            authTag,
            entry.secret,
            purpose,
            `v1.${keyId}.${purpose}`,
          ),
          keyId,
          needsRewrap: true,
        };
      } catch {
        // A v1 envelope did not bind a secret commitment. Try only another
        // explicitly authorised entry carrying the same historical key id.
      }
    }
    throw new Error("Unknown or invalid encrypted secret key");
  }

  if (parts.length === 3) {
    // Legacy envelopes carry no key id and used the raw secret-derived key.
    // Try only the explicitly authorised rotation keyring and rewrite them on
    // the first mutable read.
    for (const entry of [keyring.primary, ...keyring.previous]) {
      try {
        return {
          value: decryptSecret(value, entry.secret),
          keyId: entry.id,
          needsRewrap: true,
        };
      } catch {
        // Continue with the next explicitly configured legacy read key.
      }
    }
  }

  throw new Error("Invalid encrypted secret payload");
}

export function encryptSecret(value: string, secret: string) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", encryptionKey(secret), iv);
  const encrypted = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  const authTag = cipher.getAuthTag();

  return [
    iv.toString("base64url"),
    authTag.toString("base64url"),
    encrypted.toString("base64url"),
  ].join(".");
}

export function decryptSecret(value: string, secret: string) {
  const [iv, authTag, encrypted] = value.split(".");

  if (!iv || !authTag || !encrypted) {
    throw new Error("Invalid encrypted secret payload");
  }

  const decipher = createDecipheriv(
    "aes-256-gcm",
    encryptionKey(secret),
    Buffer.from(iv, "base64url"),
  );
  decipher.setAuthTag(Buffer.from(authTag, "base64url"));

  return Buffer.concat([
    decipher.update(Buffer.from(encrypted, "base64url")),
    decipher.final(),
  ]).toString("utf8");
}
