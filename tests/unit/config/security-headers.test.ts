import { describe, expect, it } from "vitest";

import nextConfig from "../../../next.config";

describe("application security headers", () => {
  it("enforces a CSP compatible with local assets, passkeys and Turnstile", async () => {
    const rules = await nextConfig.headers?.();
    const headers = Object.fromEntries(
      (rules?.[0]?.headers ?? []).map((header) => [header.key.toLowerCase(), header.value]),
    );

    expect(headers["content-security-policy"]).toContain("frame-ancestors 'none'");
    expect(headers["content-security-policy"]).toContain("https://challenges.cloudflare.com");
    expect(headers["content-security-policy"]).toContain("https://telegram.org");
    expect(headers["content-security-policy"]).toContain("worker-src 'self' blob:");
    expect(headers["x-content-type-options"]).toBe("nosniff");
    expect(headers["referrer-policy"]).toBe("strict-origin-when-cross-origin");
    expect(headers["permissions-policy"]).toContain("publickey-credentials-get=(self)");
    expect(headers).not.toHaveProperty("strict-transport-security");
  });
});
