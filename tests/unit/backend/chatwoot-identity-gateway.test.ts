import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  cookies: vi.fn(),
  getCurrentSessionReadOnly: vi.fn(),
  getEnv: vi.fn(),
}));

vi.mock("next/headers", () => ({ cookies: mocks.cookies }));
vi.mock("@/backend/integrations/sessions/web-session-service", () => ({
  getCurrentSessionReadOnly: mocks.getCurrentSessionReadOnly,
}));
vi.mock("@/backend/config/env", () => ({ getEnv: mocks.getEnv }));

import { productionChatwootIdentityGateway } from "@/backend/integrations/support/chatwoot-identity-gateway";

describe("Chatwoot identity gateway", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.unstubAllGlobals();
    mocks.getCurrentSessionReadOnly.mockResolvedValue({ userId: "user-1" });
    mocks.cookies.mockResolvedValue({
      get: vi.fn(() => ({ value: "conversation.token_123" })),
    });
    mocks.getEnv.mockReturnValue({
      chatwoot: {
        baseUrl: "https://chat.example.com",
        websiteToken: "website-token-123",
      },
    });
  });

  it("loads the actor and accepts only a bounded Chatwoot bearer cookie", async () => {
    await expect(productionChatwootIdentityGateway.loadActor())
      .resolves.toEqual({ userId: "user-1" });
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
  });

  it("keeps invalid, stale, oversized and unavailable probes pending", async () => {
    vi.stubGlobal("fetch", vi.fn()
      .mockResolvedValueOnce(new Response("unauthorized", { status: 401 }))
      .mockResolvedValueOnce(new Response("not-json", { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        identifier: "x".repeat(5_000),
      }), { status: 200 }))
      .mockRejectedValueOnce(new Error("offline")));

    for (let index = 0; index < 4; index += 1) {
      await expect(
        productionChatwootIdentityGateway.probeContactIdentity(
          "conversation.token_123",
        ),
      ).resolves.toEqual({ status: "pending" });
    }
  });
});
