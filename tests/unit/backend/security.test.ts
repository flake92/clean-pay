import { createCipheriv, createHmac, randomBytes } from "node:crypto";

import { describe, expect, it } from "vitest";

import {
  decryptSecret,
  decryptKeyringSecret,
  encryptSecret,
  encryptKeyringSecret,
  hmacSha256,
  jsonBase64Url,
  parseJsonBase64Url,
  randomToken,
  safeEqual,
  sha256,
} from "@/backend/security/crypto";
import { validateRequestSource } from "@/backend/security/csrf";

function encryptV1KeyringSecret(
  value: string,
  entry: { id: string; secret: string },
  purpose: string,
) {
  const iv = randomBytes(12);
  const prefix = `v1.${entry.id}`;
  const key = createHmac("sha256", entry.secret)
    .update(`clean-pay:secret-encryption:v1:${purpose}`)
    .digest();
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  cipher.setAAD(Buffer.from(`${prefix}.${purpose}`, "utf8"));
  const encrypted = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  return [
    prefix,
    iv.toString("base64url"),
    cipher.getAuthTag().toString("base64url"),
    encrypted.toString("base64url"),
  ].join(".");
}

describe("security crypto helpers", () => {
  it("hashes, signs and compares values", () => {
    expect(sha256("clean-pay")).toHaveLength(43);
    expect(hmacSha256("payload", "secret")).toHaveLength(43);
    expect(safeEqual("same", "same")).toBe(true);
    expect(safeEqual("same", "else")).toBe(false);
    expect(safeEqual("short", "longer")).toBe(false);
  });

  it("encodes json as base64url and decodes it back", () => {
    const encoded = jsonBase64Url({ sid: "s1", exp: 123 });

    expect(encoded).not.toContain("=");
    expect(parseJsonBase64Url(encoded)).toEqual({ sid: "s1", exp: 123 });
  });

  it("encrypts secrets with authenticated encryption", () => {
    const encrypted = encryptSecret("access-token", "refresh-secret");

    expect(encrypted).not.toContain("access-token");
    expect(decryptSecret(encrypted, "refresh-secret")).toBe("access-token");
    expect(() => decryptSecret(encrypted, "wrong-secret")).toThrow();
    expect(() => decryptSecret("bad.payload", "refresh-secret")).toThrow("Invalid encrypted secret payload");
  });

  it("reads legacy and previous-key envelopes and rewrites them for key retirement", () => {
    const old = { id: "key-a", secret: "synthetic-old-key-A-with-enough-entropy-123" };
    const current = { id: "key-b", secret: "synthetic-new-key-B-with-enough-entropy-456" };
    const mixed = { primary: current, previous: [old] };
    const legacy = encryptSecret("legacy-token", old.secret);
    const previous = encryptKeyringSecret(
      "previous-token",
      { primary: old, previous: [] },
      "test-purpose",
    );

    expect(decryptKeyringSecret(legacy, mixed, "test-purpose")).toMatchObject({
      value: "legacy-token",
      keyId: "key-a",
      needsRewrap: true,
    });
    expect(decryptKeyringSecret(previous, mixed, "test-purpose")).toMatchObject({
      value: "previous-token",
      keyId: "key-a",
      needsRewrap: true,
    });

    const rewrapped = encryptKeyringSecret("legacy-token", mixed, "test-purpose");
    const retired = { primary: current, previous: [] };
    expect(rewrapped).toMatch(/^v2\.key-b\.[A-Za-z0-9_-]{22}\./);
    expect(decryptKeyringSecret(rewrapped, retired, "test-purpose")).toMatchObject({
      value: "legacy-token",
      keyId: "key-b",
      needsRewrap: false,
    });
  });

  it("keeps same-id v1 rows readable only with the explicitly authorised old secret", () => {
    const old = { id: "shared-key", secret: "synthetic-old-key-A-with-enough-entropy-123" };
    const current = { id: "shared-key", secret: "synthetic-new-key-B-with-enough-entropy-456" };
    const previous = encryptV1KeyringSecret("previous-token", old, "test-purpose");
    const mixed = { primary: current, previous: [old] };

    expect(decryptKeyringSecret(previous, mixed, "test-purpose")).toMatchObject({
      value: "previous-token",
      keyId: "shared-key",
      needsRewrap: true,
    });
    expect(() => decryptKeyringSecret(
      previous,
      { primary: current, previous: [] },
      "test-purpose",
    )).toThrow("Unknown or invalid encrypted secret key");

    const rewrapped = encryptKeyringSecret("previous-token", mixed, "test-purpose");
    expect(rewrapped).toMatch(/^v2\.shared-key\.[A-Za-z0-9_-]{22}\./);
    expect(decryptKeyringSecret(
      rewrapped,
      { primary: current, previous: [] },
      "test-purpose",
    )).toMatchObject({ value: "previous-token", needsRewrap: false });
  });

  it("binds versioned envelopes to their key id and purpose", () => {
    const keyring = {
      primary: { id: "key-a", secret: "synthetic-key-A-with-enough-entropy-123456" },
      previous: [],
    };
    const encrypted = encryptKeyringSecret("token", keyring, "purpose-a");

    expect(() => decryptKeyringSecret(encrypted, keyring, "purpose-b")).toThrow();
    expect(() => decryptKeyringSecret(
      encrypted,
      { primary: { ...keyring.primary, id: "key-b" }, previous: [] },
      "purpose-a",
    )).toThrow("Unknown or invalid encrypted secret key");
  });

  it("generates url-safe random tokens", () => {
    const token = randomToken(24);

    expect(token).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(token.length).toBeGreaterThan(20);
  });
});

describe("request source policy", () => {
  it("accepts an exact trusted Origin", () => {
    expect(validateRequestSource({
      headers: new Headers({ origin: "https://app.example.com" }),
      trustedAppUrl: "https://app.example.com/path",
    })).toEqual({ ok: true });
  });

  it("uses Referer only when Origin is absent", () => {
    expect(validateRequestSource({
      headers: new Headers({ referer: "https://app.example.com/form" }),
      trustedAppUrl: "https://app.example.com",
    })).toEqual({ ok: true });
    expect(validateRequestSource({
      headers: new Headers({ origin: "null", referer: "https://app.example.com/form" }),
      trustedAppUrl: "https://app.example.com",
    })).toMatchObject({ ok: false, reason: "untrusted_origin" });
  });

  it.each([
    ["https://evil.example", "https://app.example.com"],
    ["https://app.example.com", undefined],
    ["https://user:password@app.example.com", "https://app.example.com"],
    ["not-a-url", "https://app.example.com"],
  ])("rejects an invalid or untrusted source %#", (origin, trustedAppUrl) => {
    expect(validateRequestSource({
      headers: new Headers({ origin }),
      trustedAppUrl,
    })).toEqual({ ok: false, reason: "untrusted_origin", status: 403 });
  });
});
