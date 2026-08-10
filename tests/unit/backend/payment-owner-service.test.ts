import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  prisma: { webUser: { findUnique: vi.fn() } },
}));

vi.mock("@/backend/database/prisma", () => ({ prisma: mocks.prisma }));

import { paymentUpstreamOwnerHash } from "@/backend/payments/hashes";
import {
  assertPaymentUpstreamIdentity,
  lockPaymentUpstreamOwner,
} from "@/backend/integrations/payments/payment-owner-service";
import {
  lockPrismaPaymentOwner,
  prismaPaymentOwnerReader,
} from "@/backend/integrations/payments/prisma-payment-owner-reader";

describe("payment owner persistence and identity policy", () => {
  beforeEach(() => vi.clearAllMocks());

  it("reads an existing upstream owner and returns null for absent owners", async () => {
    mocks.prisma.webUser.findUnique
      .mockResolvedValueOnce({ remnashopUserId: "owner-1" })
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ remnashopUserId: null });
    await expect(prismaPaymentOwnerReader.findUpstreamOwnerId("user-1")).resolves.toBe("owner-1");
    await expect(prismaPaymentOwnerReader.findUpstreamOwnerId("missing")).resolves.toBeNull();
    await expect(prismaPaymentOwnerReader.findUpstreamOwnerId("unlinked")).resolves.toBeNull();
    expect(mocks.prisma.webUser.findUnique).toHaveBeenCalledWith({
      where: { id: "user-1" }, select: { remnashopUserId: true },
    });
  });

  it("locks the local owner row and handles an absent row", async () => {
    const tx = { $queryRaw: vi.fn().mockResolvedValueOnce([{ remnashopUserId: "owner-1" }]).mockResolvedValueOnce([]) };
    await expect(lockPrismaPaymentOwner(tx as never, "user-1")).resolves.toBe("owner-1");
    await expect(lockPrismaPaymentOwner(tx as never, "missing")).resolves.toBeNull();
  });

  it("accepts only the exact authenticated upstream identity", async () => {
    mocks.prisma.webUser.findUnique.mockResolvedValue({ remnashopUserId: "owner-1" });
    await expect(assertPaymentUpstreamIdentity("user-1", "owner-1")).resolves.toBeUndefined();
    await expect(assertPaymentUpstreamIdentity("user-1", "owner-2")).rejects.toMatchObject({
      code: "ACCOUNT_MERGE_REQUIRED", status: 409,
    });
    mocks.prisma.webUser.findUnique.mockResolvedValueOnce(null);
    await expect(assertPaymentUpstreamIdentity("missing", "owner-1")).rejects.toMatchObject({ code: "ACCOUNT_MERGE_REQUIRED" });
  });

  it("returns the locked owner only when its digest matches", async () => {
    const tx = { $queryRaw: vi.fn().mockResolvedValue([{ remnashopUserId: "owner-1" }]) };
    await expect(lockPaymentUpstreamOwner(tx as never, "user-1", paymentUpstreamOwnerHash("owner-1"))).resolves.toBe("owner-1");
    await expect(lockPaymentUpstreamOwner(tx as never, "user-1", paymentUpstreamOwnerHash("owner-2"))).rejects.toMatchObject({
      code: "ACCOUNT_MERGE_REQUIRED",
    });
    tx.$queryRaw.mockResolvedValueOnce([]);
    await expect(lockPaymentUpstreamOwner(tx as never, "missing", paymentUpstreamOwnerHash("owner-1"))).rejects.toMatchObject({
      code: "ACCOUNT_MERGE_REQUIRED",
    });
  });
});
