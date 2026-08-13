import { describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  updateMany: vi.fn(),
}));

vi.mock("@/backend/database/prisma", () => ({
  prisma: { webSession: { updateMany: mocks.updateMany } },
}));

vi.mock("next/headers", () => ({
  cookies: vi.fn(async () => ({ delete: vi.fn() })),
}));

import { revokeWebSessionById } from "@/backend/integrations/sessions/web-session-revocation";

describe("exact web-session revocation", () => {
  it("revokes only the requested active session owned by the expected user", async () => {
    mocks.updateMany.mockResolvedValueOnce({ count: 1 });

    await revokeWebSessionById("session-new", "user-1");

    expect(mocks.updateMany).toHaveBeenCalledWith({
      where: { id: "session-new", userId: "user-1", revokedAt: null },
      data: expect.objectContaining({
        revokedAt: expect.any(Date),
        accessTokenExpiresAt: expect.any(Date),
        refreshExpiresAt: expect.any(Date),
        remnashopAccessTokenEncrypted: null,
        remnashopRefreshTokenEncrypted: null,
        remnashopRefreshClaimTokenHash: null,
        remnashopRefreshLeaseExpiresAt: null,
        remnashopRefreshDispatchedAt: null,
        remnashopRefreshRecoveryEncrypted: null,
      }),
    });
  });
});
