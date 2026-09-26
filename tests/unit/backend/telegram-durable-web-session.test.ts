import { WebSessionAuthMethod } from "@prisma/client";
import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  requestHeaders: new Headers({ "user-agent": "telegram-durable-test" }),
}));

vi.mock("next/headers", () => ({
  headers: vi.fn(async () => state.requestHeaders),
  cookies: vi.fn(),
}));

vi.mock("@/backend/database/prisma", () => ({ prisma: {} }));

import { createDurableCallbackWebSession } from "@/backend/integrations/sessions/web-session-service";
import { sha256 } from "@/backend/security/crypto";

describe("durable Telegram callback WebSession creation", () => {
  beforeEach(() => {
    vi.useRealTimers();
  });

  it("binds the request metadata, provider credentials and refresh bearer atomically", async () => {
    const now = new Date("2026-08-26T10:00:00.000Z");
    const webSessionCreate = vi.fn(async ({ data }: {
      data: Record<string, unknown>;
    }) => ({ id: "session-1", ...data }));
    const transaction = { webSession: { create: webSessionCreate } };
    const remnashopSession = {
      accessTokenEncrypted: "encrypted-access",
      refreshTokenEncrypted: "encrypted-refresh",
      accessExpiresAt: new Date("2026-08-26T10:10:00.000Z"),
      refreshExpiresAt: new Date("2026-09-26T10:00:00.000Z"),
    };

    const credentials = await createDurableCallbackWebSession(
      transaction as never,
      "user-1",
      {
        authMethod: WebSessionAuthMethod.PASSKEY,
        remnashopSession,
        now,
      },
    );

    expect(credentials.refreshToken).toHaveLength(64);
    expect(webSessionCreate).toHaveBeenCalledWith({
      data: {
        userId: "user-1",
        refreshTokenHash: sha256(credentials.refreshToken),
        remnashopAccessTokenEncrypted: "encrypted-access",
        remnashopRefreshTokenEncrypted: "encrypted-refresh",
        remnashopAccessExpiresAt: remnashopSession.accessExpiresAt,
        remnashopRefreshExpiresAt: remnashopSession.refreshExpiresAt,
        authMethod: WebSessionAuthMethod.PASSKEY,
        assuranceLevel: "FULL",
        userAgent: "telegram-durable-test",
        accessTokenExpiresAt: new Date("2026-08-26T10:15:00.000Z"),
        refreshExpiresAt: new Date("2026-09-25T10:00:00.000Z"),
      },
      include: { user: true },
    });
  });

  it("uses Telegram defaults without manufacturing provider credentials", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-26T10:00:00.000Z"));
    const webSessionCreate = vi.fn(async ({ data }: {
      data: Record<string, unknown>;
    }) => ({ id: "session-2", ...data }));

    try {
      const credentials = await createDurableCallbackWebSession(
        { webSession: { create: webSessionCreate } } as never,
        "user-2",
      );

      expect(webSessionCreate).toHaveBeenCalledWith({
        data: expect.objectContaining({
          userId: "user-2",
          refreshTokenHash: sha256(credentials.refreshToken),
          remnashopAccessTokenEncrypted: undefined,
          remnashopRefreshTokenEncrypted: undefined,
          remnashopAccessExpiresAt: undefined,
          remnashopRefreshExpiresAt: undefined,
          authMethod: WebSessionAuthMethod.TELEGRAM,
          accessTokenExpiresAt: new Date("2026-08-26T10:15:00.000Z"),
          refreshExpiresAt: new Date("2026-09-25T10:00:00.000Z"),
        }),
        include: { user: true },
      });
    } finally {
      vi.useRealTimers();
    }
  });
});
