import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  loadActor: vi.fn(),
  loadContext: vi.fn(),
  loadContextCached: vi.fn(),
  runIdentityAction: vi.fn(),
  runSupportAction: vi.fn(),
  verifyIdentity: vi.fn(),
}));

vi.mock("@/application/support/load-chatwoot-context", () => ({
  loadChatwootSupportContext: mocks.loadContext,
}));
vi.mock("@/application/support/verify-chatwoot-identity", () => ({
  verifyChatwootIdentity: mocks.verifyIdentity,
}));
vi.mock("@/app/_composition/session-gateways", () => ({
  productionChatwootContextGateway: {
    loadActor: mocks.loadActor,
  },
}));
vi.mock("@/backend/integrations/support/chatwoot-context-request-cache", () => ({
  ChatwootSupportContextCapacityError: class ChatwootSupportContextCapacityError extends Error {},
  createChatwootSupportContextRequestCache: () => ({
    load: mocks.loadContextCached,
  }),
}));
vi.mock("@/backend/integrations/support/chatwoot-identity-gateway", () => ({
  createProductionChatwootIdentityGateway: () => ({}),
}));
vi.mock("@/backend/integrations/support/chatwoot-identity-request-guard", () => {
  class ChatwootIdentityCapacityError extends Error {}

  return {
    ChatwootIdentityCapacityError,
    createChatwootIdentityRequestGuard: (options?: { actionName?: string }) => ({
      runAction: options?.actionName === "chatwoot_support_context"
        ? mocks.runSupportAction
        : mocks.runIdentityAction,
    }),
  };
});

import {
  loadChatwootSupportContextAction,
  verifyChatwootIdentityAction,
} from "@/app/actions/chatwoot";
import { ChatwootSupportContextCapacityError } from "@/backend/integrations/support/chatwoot-context-request-cache";
import { ChatwootIdentityCapacityError } from "@/backend/integrations/support/chatwoot-identity-request-guard";

describe("Chatwoot identity Server Action", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.loadActor.mockResolvedValue({ userId: "user-1" });
    mocks.loadContextCached.mockImplementation(
      async (_userId: string, loader: () => Promise<unknown>) => loader(),
    );
    mocks.runIdentityAction.mockImplementation(
      async (work: () => Promise<unknown>) => work(),
    );
    mocks.runSupportAction.mockImplementation(
      async (work: () => Promise<unknown>) => work(),
    );
  });

  it("authorizes and bounds support-context cache misses before loading providers", async () => {
    const context = {
      customAttributes: { subscription_status: "active" },
      managedLabels: [],
    };
    mocks.loadContext.mockResolvedValue(context);

    await expect(loadChatwootSupportContextAction("user-1"))
      .resolves.toEqual(context);

    expect(mocks.loadActor).toHaveBeenCalledOnce();
    expect(mocks.loadContextCached).toHaveBeenCalledWith(
      "user-1",
      expect.any(Function),
    );
    expect(mocks.runSupportAction).toHaveBeenCalledOnce();
    expect(mocks.runSupportAction.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.loadActor.mock.invocationCallOrder[0]!,
    );
    expect(mocks.loadActor.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.loadContext.mock.invocationCallOrder[0]!,
    );
    expect(mocks.loadContext).toHaveBeenCalledWith(
      expect.objectContaining({ loadActor: mocks.loadActor }),
      expect.any(Date),
      "user-1",
    );
  });

  it("never serves cached support context before current-session authorization", async () => {
    mocks.loadActor.mockResolvedValue({ userId: "another-user" });

    await expect(loadChatwootSupportContextAction("user-1"))
      .resolves.toBeNull();

    expect(mocks.loadContextCached).not.toHaveBeenCalled();
    expect(mocks.loadContext).not.toHaveBeenCalled();
    expect(mocks.runSupportAction).toHaveBeenCalledOnce();
  });

  it("authorizes the current actor before returning a server-cache hit", async () => {
    const cached = {
      customAttributes: { subscription_status: "active" },
      managedLabels: [],
    };
    mocks.loadContextCached.mockResolvedValueOnce(cached);

    await expect(loadChatwootSupportContextAction("user-1"))
      .resolves.toEqual(cached);

    expect(mocks.runSupportAction.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.loadActor.mock.invocationCallOrder[0]!,
    );
    expect(mocks.loadActor.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.loadContextCached.mock.invocationCallOrder[0]!,
    );
    expect(mocks.loadContext).not.toHaveBeenCalled();
  });

  it("degrades support context on dedicated capacity rejection without weakening identity checks", async () => {
    mocks.loadContextCached.mockRejectedValueOnce(
      new ChatwootSupportContextCapacityError("concurrency_saturated"),
    );

    await expect(loadChatwootSupportContextAction("user-1"))
      .resolves.toBeNull();
    expect(mocks.runSupportAction).toHaveBeenCalledOnce();
    expect(mocks.loadContext).not.toHaveBeenCalled();
  });

  it("fails closed before actor or provider work when the global support guard is saturated", async () => {
    mocks.runSupportAction.mockRejectedValueOnce(
      new ChatwootIdentityCapacityError("concurrency_saturated", "global"),
    );

    await expect(loadChatwootSupportContextAction("user-1"))
      .resolves.toBeNull();
    expect(mocks.loadActor).not.toHaveBeenCalled();
    expect(mocks.loadContextCached).not.toHaveBeenCalled();
    expect(mocks.loadContext).not.toHaveBeenCalled();
  });

  it("rejects malformed support-context input before session or cache work", async () => {
    await expect(loadChatwootSupportContextAction(""))
      .resolves.toBeNull();
    await expect(loadChatwootSupportContextAction("x".repeat(256)))
      .resolves.toBeNull();
    expect(mocks.loadActor).not.toHaveBeenCalled();
    expect(mocks.loadContextCached).not.toHaveBeenCalled();
    expect(mocks.runSupportAction).not.toHaveBeenCalled();
  });

  it("preserves the refresh-required verification result", async () => {
    mocks.verifyIdentity.mockResolvedValue("refresh_required");

    await expect(verifyChatwootIdentityAction("user-1"))
      .resolves.toBe("refresh_required");
  });

  it("maps only capacity rejection to a fail-closed pending result", async () => {
    mocks.runIdentityAction.mockRejectedValueOnce(
      new ChatwootIdentityCapacityError("rate_limited", "global"),
    );
    await expect(verifyChatwootIdentityAction("user-1"))
      .resolves.toBe("pending");

    mocks.runIdentityAction.mockRejectedValueOnce(new Error("database unavailable"));
    await expect(verifyChatwootIdentityAction("user-1"))
      .rejects.toThrow("database unavailable");
  });

  it("rejects malformed identity input before entering the shared request guard", async () => {
    await expect(verifyChatwootIdentityAction(""))
      .resolves.toBe("rejected");
    await expect(verifyChatwootIdentityAction("x".repeat(256)))
      .resolves.toBe("rejected");
    expect(mocks.runIdentityAction).not.toHaveBeenCalled();
    expect(mocks.verifyIdentity).not.toHaveBeenCalled();
  });
});
