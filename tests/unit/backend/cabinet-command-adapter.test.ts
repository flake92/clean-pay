import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  remnashopRequest: vi.fn(),
  getAuthorizedRemnashopTokens: vi.fn(),
  auditLog: vi.fn(),
  auditedMutation: vi.fn(),
  clearWebSession: vi.fn(),
  getWebSessionUserIdFromAccessCookie: vi.fn(),
}));

vi.mock("@/backend/integrations/remnashop/client", () => ({
  getAuthorizedRemnashopTokens: mocks.getAuthorizedRemnashopTokens,
  remnashopRequest: mocks.remnashopRequest,
}));

vi.mock("@/backend/observability/audit", () => ({
  auditLog: mocks.auditLog,
}));

vi.mock("@/backend/observability/mutation-audit", () => ({
  auditedMutation: mocks.auditedMutation,
}));

vi.mock("@/backend/integrations/sessions/web-session-service", () => ({
  clearWebSession: mocks.clearWebSession,
  getWebSessionUserIdFromAccessCookie: mocks.getWebSessionUserIdFromAccessCookie,
}));

import { CabinetCommandError } from "@/application/cabinet/ports/cabinet-commands";
import { ServiceError } from "@/backend/errors/service-error";
import { productionCabinetCommands } from "@/backend/integrations/cabinet/cabinet-commands";

describe("cabinet command adapter", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getAuthorizedRemnashopTokens.mockResolvedValue({
      accessToken: "access-token", session: { userId: "user-1" },
    });
    mocks.auditedMutation.mockImplementation(async ({ mutate }: { mutate: () => Promise<unknown> }) => mutate());
    mocks.remnashopRequest.mockResolvedValue({ ok: true });
    mocks.getWebSessionUserIdFromAccessCookie.mockResolvedValue("user-1");
  });

  it("executes every mutation through the authenticated audit boundary", async () => {
    await productionCabinetCommands.deleteDevice("device%2Eone");
    await productionCabinetCommands.deleteAllDevices();
    await productionCabinetCommands.reissueSubscription();
    await productionCabinetCommands.activatePromocode(" CLEAN ");

    expect(mocks.auditedMutation).toHaveBeenCalledTimes(4);
    expect(mocks.auditedMutation.mock.calls.map(([input]) => input.action)).toEqual([
      "device_delete", "devices_delete_all", "subscription_reissue", "promocode_activation",
    ]);
    expect(mocks.remnashopRequest).toHaveBeenNthCalledWith(1, "/subscription/devices/device%252Eone", {
      method: "DELETE", accessToken: "access-token",
    });
    expect(mocks.remnashopRequest).toHaveBeenNthCalledWith(2, "/subscription/devices", {
      method: "DELETE", accessToken: "access-token",
    });
    expect(mocks.remnashopRequest).toHaveBeenNthCalledWith(3, "/subscription/reissue", {
      method: "POST", accessToken: "access-token",
    });
    expect(mocks.remnashopRequest).toHaveBeenNthCalledWith(4, "/subscription/promocode", {
      method: "POST", accessToken: "access-token", body: { code: " CLEAN " },
    });
  });

  it.each([
    "",
    "   ",
    ".",
    "..",
    " . ",
    "/",
    "\\",
    "device/other",
    "device\\other",
    "%2e",
    "%2f",
    "%5c",
    "%252E",
    "%252F",
    "%255C",
    "device/%2e%2e/other",
    "%25%32%65",
    "%25%32%66",
    "%25%35%43",
    "%",
    "%2",
    "%GG",
    "%C0%AE",
    "%00",
  ])(
    "fails closed for path-ambiguous device HWID %j before authorization",
    async (hwid) => {
      await expect(productionCabinetCommands.deleteDevice(hwid)).rejects.toMatchObject({
        publicMessage: "Это устройство нельзя безопасно удалить отдельно.",
      });
      expect(mocks.getAuthorizedRemnashopTokens).not.toHaveBeenCalled();
      expect(mocks.auditedMutation).not.toHaveBeenCalled();
      expect(mocks.remnashopRequest).not.toHaveBeenCalled();
    },
  );

  it("audits logout before clearing the local web session", async () => {
    await productionCabinetCommands.logout();
    expect(mocks.auditLog).toHaveBeenCalledWith({ action: "auth_logout", userId: "user-1" });
    expect(mocks.auditLog.mock.invocationCallOrder[0]).toBeLessThan(mocks.clearWebSession.mock.invocationCallOrder[0]!);
  });

  it("translates infrastructure failures into the application port error", async () => {
    mocks.remnashopRequest.mockRejectedValueOnce(
      new ServiceError("PROMOCODE_EXPIRED", 409, "provider detail"),
    );

    const failure = await productionCabinetCommands.activatePromocode("EXPIRED").catch((error: unknown) => error);

    expect(failure).toBeInstanceOf(CabinetCommandError);
    expect(failure).toMatchObject({ publicMessage: "Срок действия промокода истёк." });
  });

  it("does not disguise unexpected programming failures", async () => {
    const unexpected = new TypeError("broken adapter");
    mocks.remnashopRequest.mockRejectedValueOnce(unexpected);

    await expect(productionCabinetCommands.deleteAllDevices()).rejects.toBe(unexpected);
  });
});
