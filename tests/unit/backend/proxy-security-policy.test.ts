import { describe, expect, it, vi } from "vitest";

import { createProxyRequestSecurity } from "@/shared/edge/proxy-security-policy";

describe("proxy trace and CSP policy", () => {
  it("preserves valid request and trace identifiers while deriving deterministic Edge headers", () => {
    const traceId = "1".repeat(32);
    const headers = new Headers({
      "x-request-id": "request-1234",
      traceparent: `00-${traceId}-${"2".repeat(16)}-00`,
    });
    const randomHex = vi.fn()
      .mockReturnValueOnce("a".repeat(32))
      .mockReturnValueOnce("b".repeat(16));
    const randomUuid = vi.fn(() => "generated-request-id");

    const result = createProxyRequestSecurity({
      headers,
      chatwootBaseUrl: "https://chat.example.com/path",
      chatwootConfigured: true,
      randomHex,
      randomUuid,
    });

    expect(result.requestId).toBe("request-1234");
    expect(result.traceId).toBe(traceId);
    expect(result.requestHeaders.get("traceparent")).toBe(
      `00-${traceId}-${"b".repeat(16)}-00`,
    );
    expect(result.requestHeaders.get("x-nonce")).toBe("a".repeat(32));
    expect(result.requestHeaders.get("content-security-policy")).toBe(
      result.contentSecurityPolicy,
    );
    expect(result.contentSecurityPolicy).toContain(`'nonce-${"a".repeat(32)}'`);
    expect(result.contentSecurityPolicy).toContain("https://chat.example.com");
    expect(result.contentSecurityPolicy).toContain("wss://chat.example.com");
    expect(headers.has("x-nonce")).toBe(false);
    expect(randomUuid).not.toHaveBeenCalled();
    expect(randomHex).toHaveBeenCalledTimes(2);
  });

  it("replaces invalid identifiers and does not expose an unconfigured Chatwoot origin", () => {
    const randomHex = vi.fn()
      .mockReturnValueOnce("c".repeat(32))
      .mockReturnValueOnce("d".repeat(32))
      .mockReturnValueOnce("e".repeat(16));

    const result = createProxyRequestSecurity({
      headers: new Headers({
        "x-request-id": "short",
        traceparent: `00-${"0".repeat(32)}-${"2".repeat(16)}-01`,
      }),
      chatwootBaseUrl: "https://chat.example.com",
      chatwootConfigured: false,
      randomHex,
      randomUuid: () => "generated-request-id",
    });

    expect(result.requestId).toBe("generated-request-id");
    expect(result.traceId).toBe("c".repeat(32));
    expect(result.requestHeaders.get("traceparent")).toBe(
      `00-${"c".repeat(32)}-${"e".repeat(16)}-01`,
    );
    expect(result.contentSecurityPolicy).not.toContain("chat.example.com");
    expect(randomHex.mock.calls).toEqual([[16], [16], [8]]);
  });

  it("uses the facade-injected CSP builder with the exact derived inputs", () => {
    const buildContentSecurityPolicy = vi.fn(() => "injected-csp");
    const result = createProxyRequestSecurity({
      headers: new Headers(),
      chatwootBaseUrl: "https://chat.example.com",
      chatwootConfigured: true,
      buildContentSecurityPolicy,
      randomHex: vi.fn()
        .mockReturnValueOnce("a".repeat(32))
        .mockReturnValueOnce("b".repeat(32))
        .mockReturnValueOnce("c".repeat(16)),
      randomUuid: () => "generated-request-id",
    });

    expect(buildContentSecurityPolicy).toHaveBeenCalledOnce();
    expect(buildContentSecurityPolicy).toHaveBeenCalledWith({
      nonce: "b".repeat(32),
      chatwootBaseUrl: "https://chat.example.com",
    });
    expect(result.contentSecurityPolicy).toBe("injected-csp");
    expect(result.requestHeaders.get("content-security-policy")).toBe("injected-csp");
  });
});
