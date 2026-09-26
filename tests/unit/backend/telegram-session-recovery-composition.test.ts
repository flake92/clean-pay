import { describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  authorize: vi.fn(),
  recoverStored: vi.fn(),
}));

vi.mock("@/backend/integrations/remnashop/session-authorization", () => ({
  getAuthorizedRemnashopTokens: mocks.authorize,
  recoverRemnashopTelegramSession: mocks.recoverStored,
}));

import {
  attachRemnashopTokensForTelegramSession,
  getAuthorizedRemnashopTokens,
  recoverRemnashopTelegramSession,
} from "@/app/_composition/telegram-session-recovery";
import { missingRemnashopTelegramRecovery } from "@/backend/integrations/remnashop/telegram-session-recovery-dependency";

describe("Telegram session recovery composition", () => {
  it("supplies recovery explicitly when imported in a cold process", async () => {
    mocks.authorize.mockImplementationOnce(async (options: {
      recoverTelegramSession?: unknown;
    }) => options.recoverTelegramSession);
    mocks.recoverStored.mockImplementationOnce(async (
      _sessionId: string,
      _userId: string,
      recovery: unknown,
    ) => recovery);

    await expect(getAuthorizedRemnashopTokens({ allowUnverifiedEmail: true }))
      .resolves.toBe(attachRemnashopTokensForTelegramSession);
    await expect(recoverRemnashopTelegramSession("session-1", "user-1"))
      .resolves.toBe(attachRemnashopTokensForTelegramSession);

    expect(mocks.authorize).toHaveBeenCalledWith({
      allowUnverifiedEmail: true,
      recoverTelegramSession: attachRemnashopTokensForTelegramSession,
    });
    expect(mocks.recoverStored).toHaveBeenCalledWith(
      "session-1",
      "user-1",
      attachRemnashopTokensForTelegramSession,
    );
  });

  it("fails closed when a caller omits the recovery dependency", async () => {
    await expect(missingRemnashopTelegramRecovery()).rejects.toMatchObject({
      code: "INTERNAL_ERROR",
      status: 500,
      message: "Remnashop Telegram recovery dependency was not supplied",
    });
  });
});
