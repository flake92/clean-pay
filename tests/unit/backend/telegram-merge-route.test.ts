import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  cookieValue: "confirmation-token" as string | null,
  cancel: vi.fn(),
  confirm: vi.fn(),
  get: vi.fn(),
}));

vi.mock("next/headers", () => ({
  cookies: vi.fn(async () => ({
    get: () => mocks.cookieValue ? { value: mocks.cookieValue } : undefined,
  })),
}));

vi.mock("@/backend/auth/telegram-account-merge", () => ({
  cancelTelegramAccountMerge: mocks.cancel,
  confirmTelegramAccountMerge: mocks.confirm,
  getTelegramAccountMergeConfirmation: mocks.get,
  telegramAccountMergeCookieName: "clean_pay_account_merge",
}));

import {
  DELETE,
  GET,
  POST,
} from "@/app/api/bff/auth/telegram/merge-confirmation/route";
import { BffError } from "@/backend/integrations/remnashop/errors";

describe("Telegram merge confirmation route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.cookieValue = "confirmation-token";
    mocks.get.mockResolvedValue({
      targetEmail: "owner@example.com",
      sourceEmailMasked: null,
      emailWillBeReplaced: false,
    });
    mocks.confirm.mockResolvedValue({ merged: true, userId: "user-1" });
    mocks.cancel.mockResolvedValue({ cancelled: true });
  });

  it("reads only the HttpOnly confirmation token", async () => {
    const response = await GET();

    expect(response.status).toBe(200);
    expect(mocks.get).toHaveBeenCalledWith("confirmation-token");
    await expect(response.json()).resolves.toMatchObject({
      data: {
        targetEmail: "owner@example.com",
        sourceEmailMasked: null,
        emailWillBeReplaced: false,
      },
    });
  });

  it.each([
    ["confirm", POST, mocks.confirm, { merged: true }],
    ["cancel", DELETE, mocks.cancel, { cancelled: true }],
  ] as const)("clears the confirmation cookie after %s", async (_label, handler, service, body) => {
    const response = await handler();

    expect(response.status).toBe(200);
    expect(service).toHaveBeenCalledWith("confirmation-token");
    await expect(response.json()).resolves.toMatchObject({ data: body });
    expect(response.headers.get("set-cookie")).toContain("clean_pay_account_merge=");
    expect(response.headers.get("set-cookie")).toContain("Max-Age=0");
  });

  it("does not invoke merge without the server cookie", async () => {
    mocks.cookieValue = null;

    const response = await POST();

    expect(response.status).toBe(404);
    expect(mocks.confirm).not.toHaveBeenCalled();
  });

  it("clears a terminal two-subscription confirmation", async () => {
    mocks.confirm.mockRejectedValueOnce(new BffError(
      "ACCOUNT_MERGE_SUBSCRIPTIONS_CONFLICT",
      409,
      "Two subscriptions",
    ));

    const response = await POST();

    expect(response.status).toBe(409);
    expect(response.headers.get("set-cookie")).toContain("Max-Age=0");
  });
});
