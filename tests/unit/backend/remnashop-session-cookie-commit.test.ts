import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  cookieSetCalls: [] as Array<{
    name: string;
    value: string;
    options: unknown;
  }>,
}));

const tx = vi.hoisted(() => ({
  webUser: {
    findUnique: vi.fn(),
    create: vi.fn(),
  },
  webSession: {
    create: vi.fn(),
  },
}));

const mocks = vi.hoisted(() => ({
  cookies: vi.fn(async () => ({
    set: (name: string, value: string, options: unknown) => {
      state.cookieSetCalls.push({ name, value, options });
    },
  })),
  headers: vi.fn(async () => new Headers({ "user-agent": "vitest" })),
  prisma: {
    $transaction: vi.fn(),
  },
  authDebugLog: vi.fn(),
}));

vi.mock("next/headers", () => ({
  cookies: mocks.cookies,
  headers: mocks.headers,
}));

vi.mock("@/backend/database/prisma", () => ({
  prisma: mocks.prisma,
}));

vi.mock("@/backend/observability/auth-debug-log", () => ({
  authDebugLog: mocks.authDebugLog,
}));

vi.mock("@/backend/integrations/remnashop/client", () => ({
  getRemnashopMe: vi.fn(async () => ({
    email: "user@example.com",
    is_email_verified: true,
    telegram_id: 123,
    username: "clean_user",
    name: "Clean User",
    auth_type: "email",
    pending_email: null,
    language: "ru",
  })),
  getRemnashopUserIdFromAccessToken: vi.fn(() => "remna-1"),
  protectRemnashopToken: vi.fn((token: string) => `protected:${token}`),
}));

import { createSessionFromRemnashopAuth } from "@/backend/integrations/remnashop/session";

describe("Remnashop session commit boundary", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    state.cookieSetCalls = [];
    tx.webUser.findUnique.mockResolvedValue(null);
    tx.webUser.create.mockResolvedValue({
      id: "user-1",
      email: "user@example.com",
      emailVerified: true,
      telegramId: "123",
    });
    tx.webSession.create.mockResolvedValue({
      id: "session-1",
      userId: "user-1",
      authMethod: "EMAIL",
      assuranceLevel: "FULL",
    });
  });

  it("does not write cookies when commit fails after the transaction callback succeeds", async () => {
    const commitError = new Error("transaction commit failed");
    mocks.prisma.$transaction.mockImplementationOnce(async (callback) => {
      await callback(tx);
      throw commitError;
    });

    await expect(
      createSessionFromRemnashopAuth({
        accessToken: "access",
        refreshToken: "refresh",
        auth: {
          expires_at: "2026-09-01T10:00:00.000Z",
          refresh_expires_at: "2026-10-01T10:00:00.000Z",
        },
      }),
    ).rejects.toBe(commitError);

    expect(tx.webSession.create).toHaveBeenCalledOnce();
    expect(mocks.cookies).not.toHaveBeenCalled();
    expect(state.cookieSetCalls).toEqual([]);
  });
});
