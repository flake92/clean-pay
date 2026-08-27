import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  logger: { info: vi.fn(), error: vi.fn() },
  recordUpstreamRequest: vi.fn(),
}));

vi.mock("@/backend/config/env", () => ({
  getEnv: () => ({
    appUrl: "http://localhost:8080",
    turnstile: {
      enabled: true,
      secretKey: "synthetic-secret",
      verifyUrl: "https://turnstile.example/siteverify",
    },
  }),
}));

vi.mock("@/backend/observability/logger", () => ({ logger: mocks.logger }));
vi.mock("@/backend/observability/metrics", () => ({
  recordUpstreamRequest: mocks.recordUpstreamRequest,
}));
vi.mock("@/backend/observability/request-trace", () => ({
  currentRequestTrace: vi.fn().mockResolvedValue({
    requestId: "request-id",
    traceId: "trace-id",
  }),
  tracedHeaders: (headers?: HeadersInit) => headers,
}));

import { verifyTurnstileToken } from "@/backend/security/turnstile";

describe("Turnstile upstream HTTP policy", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("forces redirect rejection and records one outcome after schema validation", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(JSON.stringify({
        success: true,
        hostname: "localhost",
        action: "auth_login",
        provider_secret: "must-not-project",
      }), { status: 200 }),
    );

    await expect(verifyTurnstileToken("token", "auth_login"))
      .resolves.toBeUndefined();

    expect(fetchMock).toHaveBeenCalledOnce();
    expect(fetchMock.mock.calls[0]?.[1]).toMatchObject({ redirect: "error" });
    expect(mocks.recordUpstreamRequest).toHaveBeenCalledOnce();
    expect(mocks.recordUpstreamRequest).toHaveBeenCalledWith({
      service: "turnstile",
      operation: "/turnstile/v0/siteverify",
      outcome: "success",
      durationMs: expect.any(Number),
    });
    expect(JSON.stringify(mocks.logger.info.mock.calls))
      .not.toContain("must-not-project");
  });

  it.each([
    ["malformed schema", () => new Response(JSON.stringify({ success: "true" }), { status: 200 })],
    ["oversized body", () => new Response("{}", {
      status: 200,
      headers: { "content-length": String(64 * 1024 + 1) },
    })],
  ])("fails closed once for a %s", async (_label, response) => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(response());

    await expect(verifyTurnstileToken("token", "auth_login"))
      .rejects.toMatchObject({ code: "UPSTREAM_UNAVAILABLE", status: 503 });
    expect(mocks.recordUpstreamRequest).toHaveBeenCalledOnce();
    expect(mocks.recordUpstreamRequest).toHaveBeenCalledWith(
      expect.objectContaining({
        service: "turnstile",
        operation: "/turnstile/v0/siteverify",
        outcome: "unavailable",
      }),
    );
  });
});
