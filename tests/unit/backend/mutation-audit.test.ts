import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ auditLog: vi.fn() }));

vi.mock("@/backend/observability/audit", () => ({ auditLog: mocks.auditLog }));

import { BffError } from "@/backend/integrations/remnashop/errors";
import { auditedMutation } from "@/backend/observability/mutation-audit";

describe("audited mutation lifecycle", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.auditLog.mockResolvedValue(undefined);
  });

  it("writes succeeded only after the mutation resolves", async () => {
    const mutate = vi.fn().mockResolvedValue({ success: true });

    await expect(
      auditedMutation({ action: "device_delete", userId: "user-1", mutate }),
    ).resolves.toEqual({ success: true });

    expect(mocks.auditLog).toHaveBeenNthCalledWith(1, {
      action: "device_delete_attempted",
      userId: "user-1",
      metadata: {},
    });
    expect(mocks.auditLog).toHaveBeenNthCalledWith(2, {
      action: "device_delete_succeeded",
      userId: "user-1",
      metadata: {},
    });
    expect(mutate.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.auditLog.mock.invocationCallOrder[1],
    );
  });

  it("writes failed with a bounded error classification and never writes success", async () => {
    const error = new BffError("UPSTREAM_UNAVAILABLE", 502, "secret upstream details");

    await expect(
      auditedMutation({
        action: "promocode_activation",
        userId: "user-1",
        metadata: { source: "cabinet" },
        mutate: async () => {
          throw error;
        },
      }),
    ).rejects.toBe(error);

    expect(mocks.auditLog).toHaveBeenLastCalledWith({
      action: "promocode_activation_failed",
      userId: "user-1",
      severity: "WARN",
      metadata: {
        source: "cabinet",
        errorCode: "UPSTREAM_UNAVAILABLE",
        errorStatus: 502,
      },
    });
    expect(mocks.auditLog).not.toHaveBeenCalledWith(
      expect.objectContaining({ action: "promocode_activation_succeeded" }),
    );
    expect(JSON.stringify(mocks.auditLog.mock.calls)).not.toContain("secret upstream details");
  });
});
