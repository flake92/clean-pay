import { describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  remnashopRequest: vi.fn(),
}));

vi.mock("@/backend/integrations/remnashop/client", () => ({
  getAuthorizedRemnashopTokens: vi.fn(async () => ({
    accessToken: "access-token",
    session: { userId: "user-1" },
  })),
  remnashopRequest: mocks.remnashopRequest,
}));

vi.mock("@/backend/observability/audit", () => ({
  auditLog: vi.fn(),
}));

vi.mock("@/backend/observability/mutation-audit", () => ({
  auditedMutation: vi.fn(async ({ mutate }: { mutate: () => Promise<unknown> }) => mutate()),
}));

vi.mock("@/backend/sessions/web-session", () => ({
  clearWebSession: vi.fn(),
}));

import { CabinetCommandError } from "@/backend/application/cabinet/ports/cabinet-commands";
import { ServiceError } from "@/backend/errors/service-error";
import { productionCabinetCommands } from "@/backend/integrations/cabinet/cabinet-commands";

describe("cabinet command adapter", () => {
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
