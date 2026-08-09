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
import { validateRequestSource } from "@/backend/security/csrf";

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
