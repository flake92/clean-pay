import { describe, expect, it, vi } from "vitest";

import type { ChatwootIdentityGateway } from "@/application/support/ports/chatwoot-identity";
import { verifyChatwootIdentity } from "@/application/support/verify-chatwoot-identity";

function gateway(
  overrides: Partial<ChatwootIdentityGateway> = {},
): ChatwootIdentityGateway {
  return {
    loadActor: vi.fn(async () => ({
      status: "authenticated" as const,
      userId: "user-1",
      sessionId: "session-1",
    })),
    loadConversationToken: vi.fn(async () => "conversation-token"),
    probeContactIdentity: vi.fn(async () => ({
      status: "available" as const,
      identifier: "user-1",
    })),
    ...overrides,
  };
}

describe("Chatwoot identity verification", () => {
  it("rejects malformed or session-mismatched browser identities", async () => {
    const malformed = gateway();
    await expect(verifyChatwootIdentity(malformed, ""))
      .resolves.toBe("rejected");
    expect(malformed.loadActor).not.toHaveBeenCalled();

    const missingActor = gateway({
      loadActor: vi.fn(async () => ({ status: "anonymous" as const })),
    });
    await expect(verifyChatwootIdentity(missingActor, "user-1"))
      .resolves.toBe("pending");

    const refreshRequired = gateway({
      loadActor: vi.fn(async () => ({ status: "refresh_required" as const })),
    });
    await expect(verifyChatwootIdentity(refreshRequired, "user-1"))
      .resolves.toBe("refresh_required");
    expect(refreshRequired.loadConversationToken).not.toHaveBeenCalled();

    const changedActor = gateway({
      loadActor: vi.fn(async () => ({
        status: "authenticated" as const,
        userId: "user-2",
        sessionId: "session-2",
      })),
    });
    await expect(verifyChatwootIdentity(changedActor, "user-1"))
      .resolves.toBe("rejected");
    expect(changedActor.loadConversationToken).not.toHaveBeenCalled();
  });

  it("waits for an identity and requests a safe reset for another contact", async () => {
    const noCookie = gateway({
      loadConversationToken: vi.fn(async () => null),
    });
    await expect(verifyChatwootIdentity(noCookie, "user-1"))
      .resolves.toBe("pending");
    expect(noCookie.probeContactIdentity).not.toHaveBeenCalled();

    await expect(verifyChatwootIdentity(gateway({
      probeContactIdentity: vi.fn(async () => ({ status: "pending" as const })),
    }), "user-1")).resolves.toBe("pending");

    await expect(verifyChatwootIdentity(gateway({
      probeContactIdentity: vi.fn(async () => ({
        status: "available" as const,
        identifier: null,
      })),
    }), "user-1")).resolves.toBe("pending");

    await expect(verifyChatwootIdentity(gateway({
      probeContactIdentity: vi.fn(async () => ({
        status: "available" as const,
        identifier: "another-user",
      })),
    }), "user-1")).resolves.toBe("reset_required");
  });

  it("confirms only the contact bound to the current Clean Pay user", async () => {
    const subject = gateway();

    await expect(verifyChatwootIdentity(subject, "user-1"))
      .resolves.toBe("confirmed");
    expect(subject.probeContactIdentity).toHaveBeenCalledWith(
      "conversation-token",
      {
        status: "authenticated",
        userId: "user-1",
        sessionId: "session-1",
      },
    );
  });
});
