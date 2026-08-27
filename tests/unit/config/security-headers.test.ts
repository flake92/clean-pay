import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import nextConfig from "../../../next.config";
import { buildContentSecurityPolicy } from "@/shared/security/content-security-policy";

describe("application security headers", () => {
  it("does not disclose the Next.js runtime through X-Powered-By", () => {
    expect(nextConfig.poweredByHeader).toBe(false);
  });

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
    const policy = buildContentSecurityPolicy({ nonce: "request-nonce" });

    expect(policy).toContain("'nonce-request-nonce'");
    expect(policy).toContain("'strict-dynamic'");
    expect(policy).not.toContain("script-src 'self' 'unsafe-inline'");
    expect(proxy).toContain("request: { headers: context.requestHeaders }");
  });

  it("allows only the configured Chatwoot origins", () => {
    const policy = buildContentSecurityPolicy({
      nonce: "safe-nonce",
      chatwootBaseUrl: "https://chat.example.com",
    });

    expect(policy).toContain("script-src 'self' 'nonce-safe-nonce' 'strict-dynamic'");
    expect(policy).toContain("https://chat.example.com");
    expect(policy).toContain("wss://chat.example.com");
    expect(policy).toContain("frame-src https://challenges.cloudflare.com https://chat.example.com");

    const invalid = buildContentSecurityPolicy({
      nonce: "safe-nonce",
      chatwootBaseUrl: "javascript:alert(1)",
    });
    expect(invalid).not.toContain("javascript:");
    expect(invalid).not.toContain("alert(1)");
  });

  it("runs the external Server Action source and byte-boundary matrix in CI", () => {
    const ci = readFileSync(".github/workflows/ci.yml", "utf8");
    const liveBoundary = readFileSync(
      "scripts/security/verify-server-action-boundary.mjs",
      "utf8",
    );

    expect(ci).toContain("verify-server-action-boundary.mjs");
    expect(liveBoundary).toContain("BODY_LIMIT = 64 * 1_024");
    expect(liveBoundary).toContain("PAYLOAD_TOO_LARGE");
    expect(liveBoundary).toContain("FORBIDDEN");
    expect(liveBoundary).toContain("application/x-www-form-urlencoded");
    expect(liveBoundary).toContain("multipart/form-data");
    expect(liveBoundary).toContain('"x-forwarded-host"');
    expect(liveBoundary).toContain('duplex: "half"');
    expect(liveBoundary).toContain('import { request as httpsRequest } from "node:https"');
    expect(liveBoundary).toContain('upstream.protocol === "https:" ? httpsRequest : httpRequest');
  });
});
