import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  runAction: vi.fn(),
  verifyIdentity: vi.fn(),
}));

vi.mock("@/application/support/verify-chatwoot-identity", () => ({
  verifyChatwootIdentity: mocks.verifyIdentity,
}));
vi.mock("@/app/_composition/session-gateways", () => ({
  productionChatwootContextGateway: {},
}));
vi.mock("@/backend/integrations/support/chatwoot-identity-gateway", () => ({
  productionChatwootIdentityGateway: {},
}));
vi.mock("@/backend/integrations/support/chatwoot-identity-request-guard", () => {
  class ChatwootIdentityCapacityError extends Error {}

  return {
    ChatwootIdentityCapacityError,
    productionChatwootIdentityRequestGuard: {
      runAction: mocks.runAction,
    },
  };
});

import { verifyChatwootIdentityAction } from "@/app/actions/chatwoot";
import { ChatwootIdentityCapacityError } from "@/backend/integrations/support/chatwoot-identity-request-guard";

describe("Chatwoot identity Server Action", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.runAction.mockImplementation(
      async (work: () => Promise<unknown>) => work(),
    );
  });

  it("preserves the refresh-required verification result", async () => {
    mocks.verifyIdentity.mockResolvedValue("refresh_required");

    await expect(verifyChatwootIdentityAction("user-1"))
      .resolves.toBe("refresh_required");
  });

  it("maps only capacity rejection to a fail-closed pending result", async () => {
    mocks.runAction.mockRejectedValueOnce(
      new ChatwootIdentityCapacityError("rate_limited", "global"),
    );
    await expect(verifyChatwootIdentityAction("user-1"))
      .resolves.toBe("pending");

    mocks.runAction.mockRejectedValueOnce(new Error("database unavailable"));
    await expect(verifyChatwootIdentityAction("user-1"))
      .rejects.toThrow("database unavailable");
  });

  it("rejects malformed identity input before entering the shared request guard", async () => {
    await expect(verifyChatwootIdentityAction(""))
      .resolves.toBe("rejected");
    await expect(verifyChatwootIdentityAction("x".repeat(256)))
      .resolves.toBe("rejected");
    expect(mocks.runAction).not.toHaveBeenCalled();
    expect(mocks.verifyIdentity).not.toHaveBeenCalled();
  });
});
