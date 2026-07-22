import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const sessionMock = vi.hoisted(() => ({
  getCurrentSession: vi.fn(),
  refreshCurrentAccessCookie: vi.fn(),
}));

vi.mock("@/backend/sessions/web-session", () => sessionMock);

vi.mock("@/backend/integrations/remnashop/session-token-lifecycle", () => ({
  acquireRemnashopTokensForSession: vi.fn(async () => null),
}));

const realDatabaseUrl = process.env.REAL_DATABASE_URL;
const describeWithPostgres = realDatabaseUrl ? describe : describe.skip;

function jwt(payload: object) {
  return `header.${Buffer.from(JSON.stringify(payload)).toString("base64url")}.signature`;
}

function jsonResponse(body: unknown, setCookie: string[] = []) {
  const result = new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
  Object.defineProperty(result.headers, "getSetCookie", {
    value: () => setCookie,
  });

  return result;
}

describeWithPostgres("Telegram recovery PostgreSQL serialization", () => {
  let prisma: typeof import("@/backend/database/prisma")["prisma"];
  let getAuthorizedRemnashopTokens: typeof import("@/backend/integrations/remnashop/client")["getAuthorizedRemnashopTokens"];
  let revealRemnashopToken: typeof import("@/backend/integrations/remnashop/token-protection")["revealRemnashopToken"];
  let protectRemnashopToken: typeof import("@/backend/integrations/remnashop/token-protection")["protectRemnashopToken"];
  let paymentUpstreamOwnerHash: typeof import("@/backend/payments/hashes")["paymentUpstreamOwnerHash"];
  const userIds: string[] = [];
  let sessionId = "";

  beforeAll(async () => {
    process.env.DATABASE_URL = realDatabaseUrl as string;
    delete (globalThis as typeof globalThis & { prisma?: unknown }).prisma;

    ({ prisma } = await import("@/backend/database/prisma"));
    ({ getAuthorizedRemnashopTokens } = await import(
      "@/backend/integrations/remnashop/client"
    ));
    ({ revealRemnashopToken, protectRemnashopToken } = await import(
      "@/backend/integrations/remnashop/token-protection"
    ));
    ({ paymentUpstreamOwnerHash } = await import("@/backend/payments/hashes"));

    const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
    const user = await prisma.webUser.create({
      data: {
        remnashopUserId: "2",
        email: `owner-${suffix}@example.com`,
        emailVerified: true,
        telegramId: `123456${Date.now().toString().slice(-5)}`,
        telegramUsername: "clean_user",
      },
    });
    const webSession = await prisma.webSession.create({
      data: {
        userId: user.id,
        refreshTokenHash: `refresh-${suffix}`,
        authMethod: "TELEGRAM",
        assuranceLevel: "FULL",
        accessTokenExpiresAt: new Date(Date.now() + 10 * 60_000),
        refreshExpiresAt: new Date(Date.now() + 60 * 60_000),
      },
      include: { user: true },
    });
    userIds.push(user.id);
    sessionId = webSession.id;
    sessionMock.getCurrentSession.mockImplementation(async () => webSession);

    let issued = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL | Request) => {
        const url = String(input);

        if (url.endsWith("/auth/telegram")) {
          issued += 1;
          const accessToken = jwt({ sub: "2", exp: 1_900_000_000 + issued });

          return jsonResponse(
            {
              expires_at: new Date(Date.now() + 10 * 60_000).toISOString(),
              refresh_expires_at: new Date(
                Date.now() + 60 * 60_000,
              ).toISOString(),
            },
            [
              `access_token=${accessToken}; Path=/; HttpOnly`,
              `refresh_token=refresh-${issued}; Path=/; HttpOnly`,
            ],
          );
        }

        if (url.endsWith("/auth/me")) {
          return jsonResponse({
            email: user.email,
            is_email_verified: true,
            telegram_id: Number(user.telegramId),
            auth_type: "telegram",
            pending_email: null,
            name: "Owner",
            username: "clean_user",
            language: "ru",
          });
        }

        throw new Error(`Unexpected request: ${url}`);
      }),
    );
  }, 120_000);

  afterAll(async () => {
    vi.unstubAllGlobals();

    if (prisma && userIds.length > 0) {
      await prisma.paymentOperation.deleteMany({
        where: { userId: { in: userIds } },
      });
      await prisma.webUser.deleteMany({ where: { id: { in: userIds } } });
      await prisma.$disconnect();
    }
  });

  it("commits exactly one winner and never overwrites it with a stale restore", async () => {
    const attempts = await Promise.allSettled([
      getAuthorizedRemnashopTokens({ allowUnverifiedEmail: true }),
      getAuthorizedRemnashopTokens({ allowUnverifiedEmail: true }),
    ]);
    const fulfilled = attempts.filter(
      (result): result is PromiseFulfilledResult<Awaited<ReturnType<typeof getAuthorizedRemnashopTokens>>> =>
        result.status === "fulfilled",
    );
    const rejected = attempts.filter(
      (result): result is PromiseRejectedResult => result.status === "rejected",
    );

    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect(rejected[0]?.reason).toMatchObject({
      code: "ACCOUNT_MERGE_REQUIRED",
      status: 409,
    });

    const stored = await prisma.webSession.findUniqueOrThrow({
      where: { id: sessionId },
    });
    expect(stored.remnashopAccessTokenEncrypted).toBeTruthy();
    expect(stored.remnashopRefreshTokenEncrypted).toBeTruthy();
    expect(
      revealRemnashopToken(stored.remnashopAccessTokenEncrypted as string),
    ).toBe(fulfilled[0]?.value.accessToken);
    expect(
      revealRemnashopToken(stored.remnashopRefreshTokenEncrypted as string),
    ).toBe(fulfilled[0]?.value.refreshToken);
  }, 60_000);

  it("preflights and rebinds target payments while invalidating sibling sessions", async () => {
    const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
    const sourceUpstreamId = "101";
    const targetUpstreamId = "202";
    const user = await prisma.webUser.create({
      data: {
        remnashopUserId: sourceUpstreamId,
        email: `merge-owner-${suffix}@example.com`,
        emailVerified: true,
        authPending: true,
        telegramId: `654321${Date.now().toString().slice(-5)}`,
        telegramUsername: "merge_user",
      },
    });
    userIds.push(user.id);
    const currentSession = await prisma.webSession.create({
      data: {
        userId: user.id,
        refreshTokenHash: `merge-current-${suffix}`,
        authMethod: "TELEGRAM",
        assuranceLevel: "FULL",
        accessTokenExpiresAt: new Date(Date.now() + 10 * 60_000),
        refreshExpiresAt: new Date(Date.now() + 60 * 60_000),
      },
      include: { user: true },
    });
    const siblingSession = await prisma.webSession.create({
      data: {
        userId: user.id,
        refreshTokenHash: `merge-sibling-${suffix}`,
        authMethod: "TELEGRAM",
        assuranceLevel: "FULL",
        accessTokenExpiresAt: new Date(Date.now() + 10 * 60_000),
        refreshExpiresAt: new Date(Date.now() + 60 * 60_000),
        remnashopAccessTokenEncrypted: protectRemnashopToken("stale-access"),
        remnashopRefreshTokenEncrypted: protectRemnashopToken("stale-refresh"),
        remnashopAccessExpiresAt: new Date(Date.now() + 10 * 60_000),
        remnashopRefreshExpiresAt: new Date(Date.now() + 60 * 60_000),
      },
    });
    const operation = await prisma.paymentOperation.create({
      data: {
        userId: user.id,
        kind: "PURCHASE",
        idempotencyKeyHash: `payment-key-${suffix}`,
        upstreamOwnerHash: paymentUpstreamOwnerHash(sourceUpstreamId),
        requestFingerprint: `fingerprint-${suffix}`,
        requestPayload: {},
        upstreamKey: `upstream-${suffix}`,
        status: "OUTCOME_UNKNOWN",
        outcomeUnknownAt: new Date(),
      },
    });
    await prisma.paymentHistorySyncState.create({
      data: {
        userId: user.id,
        upstreamOwnerHash: paymentUpstreamOwnerHash(sourceUpstreamId),
        cursor: "old-owner-cursor",
        generation: 7,
      },
    });
    sessionMock.getCurrentSession.mockReset();
    sessionMock.getCurrentSession.mockImplementation(
      async () => currentSession,
    );

    let issued = 0;
    let mergeCommitted = false;
    let mergeCalls = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL | Request) => {
        const url = String(input);

        if (url.endsWith("/auth/telegram")) {
          issued += 1;
          const accessToken = jwt({
            sub: targetUpstreamId,
            exp: 1_900_001_000 + issued,
          });

          return jsonResponse(
            {
              expires_at: new Date(Date.now() + 10 * 60_000).toISOString(),
              refresh_expires_at: new Date(
                Date.now() + 60 * 60_000,
              ).toISOString(),
            },
            [
              `access_token=${accessToken}; Path=/; HttpOnly`,
              `refresh_token=merge-refresh-${issued}; Path=/; HttpOnly`,
            ],
          );
        }

        if (url.endsWith("/auth/me")) {
          return jsonResponse({
            email: mergeCommitted ? user.email : null,
            is_email_verified: mergeCommitted,
            telegram_id: Number(user.telegramId),
            auth_type: "telegram",
            pending_email: null,
            name: "Merge Owner",
            username: "merge_user",
            language: "ru",
          });
        }

        if (url.endsWith("/users/merge?dry_run=false")) {
          mergeCalls += 1;
          mergeCommitted = true;

          return jsonResponse({
            dry_run: false,
            source_user_id: Number(sourceUpstreamId),
            target_user_id: Number(targetUpstreamId),
            target: {
              id: Number(targetUpstreamId),
              email: user.email,
              telegram_id: Number(user.telegramId),
              is_email_verified: true,
              current_subscription_id: null,
            },
            moved: {},
            conflicts: [],
            requires_relogin: true,
          });
        }

        throw new Error(`Unexpected request: ${url}`);
      }),
    );

    const attempts = await Promise.allSettled([
      getAuthorizedRemnashopTokens({ allowUnverifiedEmail: true }),
      getAuthorizedRemnashopTokens({ allowUnverifiedEmail: true }),
    ]);
    expect(attempts.filter(({ status }) => status === "fulfilled")).toHaveLength(
      1,
    );
    expect(attempts.filter(({ status }) => status === "rejected")).toHaveLength(
      1,
    );
    expect(mergeCalls).toBe(1);

    const [storedUser, storedOperation, storedHistory, storedSibling] =
      await Promise.all([
        prisma.webUser.findUniqueOrThrow({ where: { id: user.id } }),
        prisma.paymentOperation.findUniqueOrThrow({
          where: { id: operation.id },
        }),
        prisma.paymentHistorySyncState.findUniqueOrThrow({
          where: { userId: user.id },
        }),
        prisma.webSession.findUniqueOrThrow({
          where: { id: siblingSession.id },
        }),
      ]);
    expect(storedUser.remnashopUserId).toBe(targetUpstreamId);
    expect(storedUser.authPending).toBe(false);
    expect(storedOperation.upstreamOwnerHash).toBe(
      paymentUpstreamOwnerHash(targetUpstreamId),
    );
    expect(storedOperation.status).toBe("OUTCOME_UNKNOWN");
    expect(storedOperation.reconciledAt).toBeInstanceOf(Date);
    expect(storedOperation.reconcileErrorSnapshot).toMatchObject({
      code: "MANUAL_REQUIRED",
      reason: "UPSTREAM_OWNER_REBOUND",
    });
    expect(storedHistory.upstreamOwnerHash).toBe(
      paymentUpstreamOwnerHash(targetUpstreamId),
    );
    expect(storedHistory.cursor).toBeNull();
    expect(storedHistory.generation).toBe(8);
    expect(storedSibling.remnashopAccessTokenEncrypted).toBeNull();
    expect(storedSibling.remnashopRefreshTokenEncrypted).toBeNull();
  }, 60_000);

  it("merges a durable pending e-mail owner when the current local owner already points to Telegram", async () => {
    const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
    const sourceUpstreamId = "301";
    const targetUpstreamId = "302";
    const email = `pending-owner-${suffix}@example.com`;
    const telegramId = `765432${Date.now().toString().slice(-5)}`;
    const [currentUser, emailOwner] = await Promise.all([
      prisma.webUser.create({
        data: {
          remnashopUserId: targetUpstreamId,
          emailVerified: false,
          authPending: true,
          pendingRemnashopUserId: sourceUpstreamId,
          pendingRemnashopEmail: email,
          telegramId,
          telegramUsername: "pending_merge_user",
        },
      }),
      prisma.webUser.create({
        data: {
          remnashopUserId: sourceUpstreamId,
          email,
          emailVerified: true,
        },
      }),
    ]);
    userIds.push(currentUser.id, emailOwner.id);
    const currentSession = await prisma.webSession.create({
      data: {
        userId: currentUser.id,
        refreshTokenHash: `pending-merge-${suffix}`,
        authMethod: "TELEGRAM",
        assuranceLevel: "FULL",
        accessTokenExpiresAt: new Date(Date.now() + 10 * 60_000),
        refreshExpiresAt: new Date(Date.now() + 60 * 60_000),
      },
      include: { user: true },
    });
    sessionMock.getCurrentSession.mockReset();
    sessionMock.getCurrentSession.mockResolvedValue(currentSession);

    let mergeCommitted = false;
    let issued = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL | Request) => {
        const url = String(input);

        if (url.endsWith("/auth/telegram")) {
          issued += 1;
          const accessToken = jwt({
            sub: targetUpstreamId,
            exp: 1_900_002_000 + issued,
          });

          return jsonResponse(
            {
              expires_at: new Date(Date.now() + 10 * 60_000).toISOString(),
              refresh_expires_at: new Date(
                Date.now() + 60 * 60_000,
              ).toISOString(),
            },
            [
              `access_token=${accessToken}; Path=/; HttpOnly`,
              `refresh_token=pending-refresh-${issued}; Path=/; HttpOnly`,
            ],
          );
        }

        if (url.endsWith("/auth/me")) {
          return jsonResponse({
            email: mergeCommitted ? email : null,
            is_email_verified: mergeCommitted,
            telegram_id: Number(telegramId),
            auth_type: "telegram",
            pending_email: null,
            name: "Pending Merge Owner",
            username: "pending_merge_user",
            language: "ru",
          });
        }

        if (url.endsWith("/users/merge?dry_run=false")) {
          mergeCommitted = true;

          return jsonResponse({
            dry_run: false,
            source_user_id: Number(sourceUpstreamId),
            target_user_id: Number(targetUpstreamId),
            target: {
              id: Number(targetUpstreamId),
              email,
              telegram_id: Number(telegramId),
              is_email_verified: true,
              current_subscription_id: null,
            },
            moved: {},
            conflicts: [],
            requires_relogin: true,
          });
        }

        throw new Error(`Unexpected request: ${url}`);
      }),
    );

    await expect(
      getAuthorizedRemnashopTokens({ allowUnverifiedEmail: true }),
    ).resolves.toMatchObject({
      session: {
        user: {
          id: currentUser.id,
          remnashopUserId: targetUpstreamId,
          email,
          emailVerified: true,
          authPending: false,
          pendingRemnashopUserId: null,
          pendingRemnashopEmail: null,
        },
      },
    });

    const [storedCurrent, deletedSource] = await Promise.all([
      prisma.webUser.findUniqueOrThrow({ where: { id: currentUser.id } }),
      prisma.webUser.count({ where: { id: emailOwner.id } }),
    ]);
    expect(deletedSource).toBe(0);
    expect(storedCurrent).toMatchObject({
      remnashopUserId: targetUpstreamId,
      email,
      emailVerified: true,
      authPending: false,
      pendingRemnashopUserId: null,
      pendingRemnashopEmail: null,
      telegramId,
    });
  }, 60_000);
});
