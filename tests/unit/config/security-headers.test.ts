import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import nextConfig from "../../../next.config";

describe("application security headers", () => {
  it("keeps transport security headers on every response", async () => {
    const rules = await nextConfig.headers?.();
    const headers = Object.fromEntries(
      (rules?.[0]?.headers ?? []).map((header) => [header.key.toLowerCase(), header.value]),
    );

    expect(headers).not.toHaveProperty("content-security-policy");
    expect(headers["x-content-type-options"]).toBe("nosniff");
    expect(headers["referrer-policy"]).toBe("strict-origin-when-cross-origin");
    expect(headers["permissions-policy"]).toContain("publickey-credentials-get=(self)");
    expect(headers["strict-transport-security"]).toBe(
      "max-age=31536000; includeSubDomains",
    );
  });

  it("generates a per-request nonce CSP without unsafe inline scripts", () => {
    const proxy = readFileSync("src/proxy.ts", "utf8");

    expect(proxy).toContain("'nonce-${nonce}'");
    expect(proxy).toContain("'strict-dynamic'");
    expect(proxy).not.toContain("script-src 'self' 'unsafe-inline'");
    expect(proxy).toContain("request: { headers: context.requestHeaders }");
  });
});
