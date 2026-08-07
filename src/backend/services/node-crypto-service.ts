import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";

import type { CryptoService } from "@/backend/services/crypto-service";

function encryptionKey(secret: string) {
  return createHash("sha256").update(secret).digest();
}

export const nodeCryptoService: CryptoService = {
  randomToken(bytes: number): string {
    return randomBytes(bytes).toString("base64url");
  },

  randomUUID(): string {
    return randomUUID();
  },

  sha256(value: string): string {
    return createHash("sha256").update(value).digest("base64url");
  },

  hmacSha256(value: string, secret: string): string {
    return createHmac("sha256", secret).update(value).digest("hex");
  },

  safeEqual(left: string, right: string): boolean {
    if (left.length !== right.length) {
      return false;
    }
    return timingSafeEqual(Buffer.from(left), Buffer.from(right));
  },

  encryptSecret(value: string, secret: string): string {
    const iv = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", encryptionKey(secret), iv);
    const encrypted = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
    const authTag = cipher.getAuthTag();
    return [iv.toString("base64url"), authTag.toString("base64url"), encrypted.toString("base64url")].join(".");
  },

  decryptSecret(encrypted: string, secret: string): string {
    const parts = encrypted.split(".");
    if (parts.length !== 3) {
      throw new Error("Invalid encrypted format");
    }
    const [ivB64, tagB64, dataB64] = parts;
    const iv = Buffer.from(ivB64, "base64url");
    const authTag = Buffer.from(tagB64, "base64url");
    const data = Buffer.from(dataB64, "base64url");
    const decipher = createDecipheriv("aes-256-gcm", encryptionKey(secret), iv);
    decipher.setAuthTag(authTag);
    return Buffer.concat([decipher.update(data), decipher.final()]).toString("utf8");
  },

  jsonBase64Url(value: unknown): string {
    return Buffer.from(JSON.stringify(value)).toString("base64url");
  },

  parseJsonBase64Url<T>(value: string): T {
    return JSON.parse(Buffer.from(value, "base64url").toString("utf8")) as T;
  },
};
