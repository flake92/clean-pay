import { describe, expect, it } from "vitest";

import {
  decryptSecret,
  encryptSecret,
  hmacSha256,
  jsonBase64Url,
  parseJsonBase64Url,
  randomToken,
  safeEqual,
  sha256,
} from "@/backend/security/crypto";

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

  it("generates url-safe random tokens", () => {
    const token = randomToken(24);

    expect(token).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(token.length).toBeGreaterThan(20);
  });
});
