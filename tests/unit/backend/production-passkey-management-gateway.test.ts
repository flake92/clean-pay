import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getCurrentSession: vi.fn(), deleteOwnedPasskey: vi.fn(), auditLog: vi.fn(),
  findMany: vi.fn(),
}));
vi.mock("@/backend/integrations/sessions/web-session-service", () => ({ getCurrentSession: mocks.getCurrentSession }));
vi.mock("@/backend/integrations/auth/passkey-service", () => ({ deleteOwnedPasskey: mocks.deleteOwnedPasskey }));
vi.mock("@/backend/observability/audit", () => ({ auditLog: mocks.auditLog }));
vi.mock("@/backend/database/prisma", () => ({ prisma: { webAuthnCredential: { findMany: mocks.findMany } } }));

import { productionPasskeyManagementGateway } from "@/app/_composition/action-runtime";

describe("production passkey management gateway", () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it("returns null without a session and maps assurance without deciding access", async () => {
    mocks.getCurrentSession.mockResolvedValueOnce(null);
    await expect(productionPasskeyManagementGateway.loadActor()).resolves.toBeNull();
    mocks.getCurrentSession.mockResolvedValueOnce({
      userId: "user-1", assuranceLevel: "BOOTSTRAP",
      user: { email: null, emailVerified: false, telegramId: "777" },
    });
    await expect(productionPasskeyManagementGateway.loadActor()).resolves.toEqual({
      userId: "user-1", fullAssurance: false, email: null, emailVerified: false, telegramId: "777",
    });
  });

  it("maps owned credentials and delegates atomic deletion and audit", async () => {
    mocks.findMany.mockResolvedValue([{ id: "key-1", name: "Laptop", createdAt: new Date("2026-01-01"), lastUsedAt: new Date("2026-01-02") }]);
    await expect(productionPasskeyManagementGateway.loadOwned("user-1")).resolves.toEqual([{
      id: "key-1", name: "Laptop", createdAt: "2026-01-01T00:00:00.000Z", lastUsedAt: "2026-01-02T00:00:00.000Z",
    }]);
    expect(mocks.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { userId: "user-1" } }));

    mocks.deleteOwnedPasskey.mockResolvedValue({ credentialId: "external-1" });
    await expect(productionPasskeyManagementGateway.deleteOwned("user-1", "key-1"))
      .resolves.toEqual({ externalCredentialId: "external-1" });
    await productionPasskeyManagementGateway.auditDeleted("user-1", "external-1");
    expect(mocks.auditLog).toHaveBeenCalledWith({ action: "passkey_deleted", userId: "user-1", metadata: { credentialId: "external-1" } });
  });
});
