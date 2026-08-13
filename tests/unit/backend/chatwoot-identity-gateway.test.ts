import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  cookies: vi.fn(),
  getCurrentRefreshSessionCandidateReadOnly: vi.fn(),
  getCurrentSessionReadOnly: vi.fn(),
  getEnv: vi.fn(),
  loggerInfo: vi.fn(),
  loggerWarn: vi.fn(),
  recordUpstreamRequest: vi.fn(),
}));

vi.mock("next/headers", () => ({ cookies: mocks.cookies }));
vi.mock("@/backend/integrations/sessions/web-session-service", () => ({
  getCurrentRefreshSessionCandidateReadOnly:
    mocks.getCurrentRefreshSessionCandidateReadOnly,
  getCurrentSessionReadOnly: mocks.getCurrentSessionReadOnly,
}));
vi.mock("@/backend/config/env", () => ({ getEnv: mocks.getEnv }));
vi.mock("@/backend/observability/logger", () => ({
  logger: {
    info: mocks.loggerInfo,
    warn: mocks.loggerWarn,
  },
}));
vi.mock("@/backend/observability/metrics", () => ({
  recordUpstreamRequest: mocks.recordUpstreamRequest,
}));

import { productionChatwootIdentityGateway } from "@/backend/integrations/support/chatwoot-identity-gateway";

const actor = {
  status: "authenticated" as const,
  userId: "user-1",
  sessionId: "session-1",
};

describe("Chatwoot identity gateway", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.unstubAllGlobals();
    mocks.getCurrentSessionReadOnly.mockResolvedValue({
      id: "session-1",
      userId: "user-1",
    });
    mocks.getCurrentRefreshSessionCandidateReadOnly.mockResolvedValue(null);
    mocks.cookies.mockResolvedValue({
      get: vi.fn(() => ({ value: "conversation.token_123" })),
    });
    mocks.getEnv.mockReturnValue({
      authConcurrencyLimit: 64,
      authRateLimitCapacity: 1_000,
      rateLimitIdentitySecret: "chatwoot-rate-limit-test-secret",
      chatwoot: {
        baseUrl: "https://chat.example.com",
        websiteToken: "website-token-123",
      },
    });
  });

  it("loads the actor and accepts only a bounded Chatwoot bearer cookie", async () => {
    await expect(productionChatwootIdentityGateway.loadActor())
      .resolves.toEqual(actor);
    await expect(productionChatwootIdentityGateway.loadConversationToken())
      .resolves.toBe("conversation.token_123");

    mocks.cookies.mockResolvedValueOnce({
      get: vi.fn(() => ({ value: "invalid token with spaces" })),
    });
    await expect(productionChatwootIdentityGateway.loadConversationToken())
      .resolves.toBeNull();
  });

  it("reads the current contact identifier without forwarding response data", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({
      id: 42,
      identifier: "user-1",
      email: "must-not-be-consumed@example.com",
    }), {
      status: 200,
      headers: { "content-type": "application/json" },
    }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      productionChatwootIdentityGateway.probeContactIdentity(
        "conversation.token_123",
        actor,
      ),
    ).resolves.toEqual({ status: "available", identifier: "user-1" });
    expect(fetchMock).toHaveBeenCalledWith(
      new URL("https://chat.example.com/api/v1/widget/contact?website_token=website-token-123"),
      expect.objectContaining({
        method: "GET",
        cache: "no-store",
        redirect: "error",
        headers: {
          Accept: "application/json",
          "X-Auth-Token": "conversation.token_123",
        },
      }),
    );
    expect(mocks.recordUpstreamRequest).toHaveBeenCalledWith({
      service: "chatwoot",
      operation: "/api/v1/widget/contact",
      outcome: "success",
      durationMs: expect.any(Number),
    });
    expect(mocks.loggerInfo).toHaveBeenCalledWith(
      "chatwoot_identity_probe_completed",
      {
        durationMs: expect.any(Number),
        identityAvailable: true,
      },
      expect.objectContaining({ source: "chatwoot.identity" }),
    );
    expect(JSON.stringify(mocks.loggerInfo.mock.calls))
      .not.toContain("conversation.token_123");
    expect(JSON.stringify(mocks.loggerInfo.mock.calls))
      .not.toContain("user-1");
  });

  it("keeps invalid, stale, malformed, oversized and unavailable probes pending", async () => {
    vi.stubGlobal("fetch", vi.fn()
      .mockResolvedValueOnce(new Response("unauthorized", { status: 401 }))
      .mockResolvedValueOnce(new Response("not-json", { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        identifier: 42,
      }), { status: 200 }))
      .mockResolvedValueOnce(new Response(null, { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        identifier: "x".repeat(5_000),
      }), { status: 200 }))
      .mockRejectedValueOnce(new Error("offline")));

    for (let index = 0; index < 6; index += 1) {
      await expect(
        productionChatwootIdentityGateway.probeContactIdentity(
          "conversation.token_123",
          actor,
        ),
      ).resolves.toEqual({ status: "pending" });
    }

    expect(mocks.recordUpstreamRequest).toHaveBeenCalledWith({
      service: "chatwoot",
      operation: "/api/v1/widget/contact",
      outcome: "rejected",
      durationMs: expect.any(Number),
    });
    expect(mocks.recordUpstreamRequest).toHaveBeenCalledWith({
      service: "chatwoot",
      operation: "/api/v1/widget/contact",
      outcome: "unavailable",
      durationMs: expect.any(Number),
    });
    expect(mocks.loggerWarn).toHaveBeenCalledWith(
      "chatwoot_identity_probe_rejected",
      { status: 401, durationMs: expect.any(Number) },
      expect.objectContaining({ source: "chatwoot.identity" }),
    );
    expect(mocks.loggerWarn).toHaveBeenCalledWith(
      "chatwoot_identity_probe_unavailable",
      { durationMs: expect.any(Number), errorName: "Error" },
      expect.objectContaining({ source: "chatwoot.identity" }),
    );
    expect(mocks.loggerWarn).toHaveBeenCalledWith(
      "chatwoot_identity_probe_response_invalid",
      { durationMs: expect.any(Number) },
      expect.objectContaining({ source: "chatwoot.identity" }),
    );
    expect(mocks.recordUpstreamRequest).not.toHaveBeenCalledWith(
      expect.objectContaining({ outcome: "success" }),
    );
    expect(JSON.stringify(mocks.loggerWarn.mock.calls))
      .not.toContain("conversation.token_123");
    expect(JSON.stringify(mocks.loggerWarn.mock.calls))
      .not.toContain("user-1");
  });

  it("does not probe when Chatwoot is disabled", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    mocks.getEnv.mockReturnValueOnce({
      authConcurrencyLimit: 64,
      authRateLimitCapacity: 1_000,
      rateLimitIdentitySecret: "chatwoot-rate-limit-test-secret",
      chatwoot: null,
    });

    await expect(productionChatwootIdentityGateway.probeContactIdentity(
      "conversation.token_123",
      actor,
    )).resolves.toEqual({ status: "pending" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("signals a verified refresh candidate without rotating it", async () => {
    mocks.getCurrentSessionReadOnly.mockResolvedValueOnce(null);
    mocks.getCurrentRefreshSessionCandidateReadOnly.mockResolvedValueOnce({
      sessionId: "session-1",
      userId: "user-1",
    });

    await expect(productionChatwootIdentityGateway.loadActor())
      .resolves.toEqual({ status: "refresh_required" });

    mocks.getCurrentSessionReadOnly.mockResolvedValueOnce(null);
    mocks.getCurrentRefreshSessionCandidateReadOnly.mockResolvedValueOnce(null);
    await expect(productionChatwootIdentityGateway.loadActor())
      .resolves.toEqual({ status: "anonymous" });
  });

  it("keeps a response whose body stream rejects pending", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(
      new ReadableStream({
        pull(controller) {
          controller.error(new Error("stream reset"));
        },
      }),
      { status: 200 },
    )));

    await expect(
      productionChatwootIdentityGateway.probeContactIdentity(
        "conversation.stream_failure",
        actor,
      ),
    ).resolves.toEqual({ status: "pending" });
  });

  it("does not double-count an HTTP rejection when body cancellation fails", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(
      new ReadableStream({
        cancel() {
          throw new Error("stream cancel failed");
        },
      }),
      { status: 401 },
    )));

    await expect(
      productionChatwootIdentityGateway.probeContactIdentity(
        "conversation.cancel_failure",
        actor,
      ),
    ).resolves.toEqual({ status: "pending" });

    expect(mocks.recordUpstreamRequest).toHaveBeenCalledTimes(1);
    expect(mocks.recordUpstreamRequest).toHaveBeenCalledWith({
      service: "chatwoot",
      operation: "/api/v1/widget/contact",
      outcome: "rejected",
      durationMs: expect.any(Number),
    });
  });
});
