import { describe, expect, it, vi } from "vitest";

import { removeLinkedPasskey } from "@/application/auth/manage-linked-account";
import type { PasskeyManagementGateway } from "@/application/auth/ports/passkey-management";

function gateway(overrides: Partial<PasskeyManagementGateway> = {}): PasskeyManagementGateway {
  return {
    loadActor: vi.fn(async () => ({ userId: "user-1", fullAssurance: true, email: "u@example.com", emailVerified: true, telegramId: null })),
    loadOwned: vi.fn(async () => []),
    deleteOwned: vi.fn(async () => ({ externalCredentialId: "external-1" })),
    auditDeleted: vi.fn(async () => undefined),
    ...overrides,
  };
}

describe("application passkey management policy", () => {
  it.each([
    [null, "UNAUTHORIZED"],
    [{ userId: "user-1", fullAssurance: false, email: "u@example.com", emailVerified: true, telegramId: null }, "UNAUTHORIZED"],
    [{ userId: "user-1", fullAssurance: true, email: null, emailVerified: false, telegramId: null }, "EMAIL_NOT_VERIFIED"],
  ])("rejects an ineligible actor before deletion", async (actor, code) => {
    const port = gateway({ loadActor: vi.fn(async () => actor) });
    await expect(removeLinkedPasskey(port, "key-1")).resolves.toMatchObject({ ok: false, code });
    expect(port.deleteOwned).not.toHaveBeenCalled();
  });

  it("deletes an owned credential before recording the audit event", async () => {
    const order: string[] = [];
    const port = gateway({
      deleteOwned: vi.fn(async (userId, id) => { order.push("delete"); expect([userId, id]).toEqual(["user-1", "key-1"]); return { externalCredentialId: "external-1" }; }),
      auditDeleted: vi.fn(async () => { order.push("audit"); }),
    });
    await expect(removeLinkedPasskey(port, "key-1")).resolves.toEqual({ ok: true, kind: "passkey-deleted" });
    expect(order).toEqual(["delete", "audit"]);
    expect(port.auditDeleted).toHaveBeenCalledWith("user-1", "external-1");
  });

  it("does not report success when persistence fails", async () => {
    const port = gateway({ deleteOwned: vi.fn(async () => { throw Object.assign(new Error(), { code: "NOT_FOUND" }); }) });
    await expect(removeLinkedPasskey(port, "missing")).resolves.toMatchObject({ ok: false, code: "NOT_FOUND" });
    expect(port.auditDeleted).not.toHaveBeenCalled();
  });
});
