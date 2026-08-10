import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  auditLog: vi.fn(),
  prisma: {
    $transaction: vi.fn(), $queryRaw: vi.fn(),
    webAuthnCredential: { update: vi.fn(), updateMany: vi.fn(), findMany: vi.fn(), findFirst: vi.fn(), count: vi.fn(), delete: vi.fn() },
  },
}));
vi.mock("@/backend/database/prisma", () => ({ prisma: mocks.prisma }));
vi.mock("@/backend/observability/audit", () => ({ auditLog: mocks.auditLog }));

import { deleteOwnedPasskey, recordPasskeyUse } from "@/backend/integrations/auth/passkey-service";

describe("passkey persistence adapter", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.prisma.$transaction.mockImplementation(async (work: (tx: typeof mocks.prisma) => Promise<unknown>) => work(mocks.prisma));
    mocks.prisma.$queryRaw.mockResolvedValue([{ id: "user-1" }]);
    mocks.prisma.webAuthnCredential.findFirst.mockResolvedValue({ id: "key-1", credentialId: "credential-1" });
    mocks.prisma.webAuthnCredential.count.mockResolvedValue(2);
  });

  it("records counterless and monotonic authenticator use", async () => {
    await recordPasskeyUse({ id: "key-1", userId: "user-1", credentialId: "credential-1", oldCounter: 0n, newCounter: 0n });
    mocks.prisma.webAuthnCredential.updateMany.mockResolvedValueOnce({ count: 1 });
    await recordPasskeyUse({ id: "key-1", userId: "user-1", credentialId: "credential-1", oldCounter: 1n, newCounter: 2n });
    expect(mocks.prisma.webAuthnCredential.update).toHaveBeenCalled();
    expect(mocks.prisma.webAuthnCredential.updateMany).toHaveBeenCalledWith(expect.objectContaining({ where: { id: "key-1", counter: 1n } }));
  });

  it("atomically deletes only an owned non-final credential", async () => {
    await expect(deleteOwnedPasskey("user-1", "key-1")).resolves.toMatchObject({ credentialId: "credential-1" });
    expect(mocks.prisma.webAuthnCredential.delete).toHaveBeenCalledWith({ where: { id: "key-1" } });
  });

  it("rejects a counter race and deleting the last credential", async () => {
    mocks.prisma.webAuthnCredential.updateMany.mockResolvedValueOnce({ count: 0 });
    await expect(recordPasskeyUse({ id: "key-1", userId: "user-1", credentialId: "credential-1", oldCounter: 1n, newCounter: 2n }))
      .rejects.toMatchObject({ code: "UNAUTHORIZED" });
    mocks.prisma.webAuthnCredential.count.mockResolvedValueOnce(1);
    await expect(deleteOwnedPasskey("user-1", "key-1")).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
});
