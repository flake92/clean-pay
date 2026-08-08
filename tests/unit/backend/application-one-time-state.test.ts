import { describe, expect, it, vi } from "vitest";
import { claimOneTimeState } from "@/backend/application/auth/claim-one-time-state";
import type { OneTimeStateRepository } from "@/backend/application/auth/ports/one-time-state";

describe("claimOneTimeState", () => {
  it("delegates the atomic compare-and-set to the repository", async () => {
    const consumedAt = new Date("2026-08-09T00:00:00.000Z");
    const repository: OneTimeStateRepository = { claim: vi.fn(async () => true) };
    await expect(claimOneTimeState(repository, "webauthn-challenge", "challenge-1", consumedAt)).resolves.toBe(true);
    expect(repository.claim).toHaveBeenCalledWith({ kind: "webauthn-challenge", id: "challenge-1", consumedAt });
  });
});
