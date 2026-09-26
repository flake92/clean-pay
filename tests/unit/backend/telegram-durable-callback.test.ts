import { beforeEach, describe, expect, it, vi } from "vitest";

const oldKeyringEntry = {
  id: "callback-key-a",
  secret: "synthetic-callback-key-A-7Pk2Fm9Qs4Wv8Jd3",
};

const keyring = {
  primary: {
    id: "callback-key-b",
    secret: "synthetic-callback-key-B-4Lc8Kq2Vr9Nm5Xs7",
  },
  previous: [oldKeyringEntry],
};

const mocks = vi.hoisted(() => ({
  findUnique: vi.fn(),
  updateMany: vi.fn(),
  queryRaw: vi.fn(),
  transaction: vi.fn(),
  webSessionFindFirst: vi.fn(),
  webSessionUpdateMany: vi.fn(),
  accountMergeUpdateMany: vi.fn(),
  createDurableCallbackWebSession: vi.fn(),
  recordOperationalEvent: vi.fn(),
}));

vi.mock("@/backend/database/prisma", () => ({
  prisma: {
    telegramAuthState: {
      findUnique: mocks.findUnique,
      updateMany: mocks.updateMany,
    },
    webSession: {
      findFirst: mocks.webSessionFindFirst,
      updateMany: mocks.webSessionUpdateMany,
    },
    $transaction: mocks.transaction,
  },
}));
vi.mock("@/backend/integrations/sessions/web-session-service", () => ({
  createDurableCallbackWebSession: mocks.createDurableCallbackWebSession,
}));
vi.mock("@/backend/config/env", () => ({
  getEnv: () => ({ webRefreshKeyring: keyring }),
}));
vi.mock("@/backend/observability/metrics", () => ({
  recordOperationalEvent: mocks.recordOperationalEvent,
}));

import {
  claimDurableTelegramProviderReady,
  checkpointDurableTelegramIdentity,
  checkpointDurableTelegramIdentityResolved,
  checkpointDurableTelegramOutcome,
  checkpointDurableTelegramProvider,
  checkpointDurableTelegramRecoveryCommitted,
  completeDurableTelegramMerge,
  completeDurableTelegramSession,
  createDurableTelegramCallbackSession,
  failDurableTelegramCallback,
  loadDurableTelegramCallback,
  markDurableTelegramProviderDispatching,
  markDurableTelegramRecoveryDispatching,
  markDurableTelegramRemnashopDispatching,
  releaseDurableTelegramCallback,
  runWithDurableTelegramCallbackLease,
} from "@/backend/integrations/telegram/durable-callback";
import {
  encryptKeyringSecret,
  sha256,
} from "@/backend/security/crypto";

const state = "telegram-state-with-sufficient-entropy";
const code = "one-time-authorization-code";
const now = new Date("2026-08-25T12:00:00.000Z");
const proof = {
  stateHash: sha256(state),
  nonceHash: sha256("original-nonce-cookie"),
  codeVerifierHash: sha256("original-pkce-cookie"),
};
const ownership = {
  authStateId: "auth-state-1",
  stateHash: proof.stateHash,
  codeHash: sha256(code),
  claimToken: "callback-claim-token",
};
const replay = {
  redirectTo: "/cabinet",
  session: {
    webSessionId: "web-session-1",
    userId: "user-1",
    bootstrapRefreshToken: "new-browser-refresh-token",
    requiresTelegramRecovery: true,
  },
  audit: { userId: "user-1", remnashopLinked: true },
};
const outcome = {
  redirectTo: "/cabinet",
  session: {
    userId: "user-1",
    requiresTelegramRecovery: true,
  },
  audit: { userId: "user-1", remnashopLinked: true },
};
const providerSession = {
  context: {
    cookies: { accessToken: "access-token", refreshToken: "refresh-token" },
    data: {
      expires_at: "2026-08-25T12:15:00.000Z",
      refresh_expires_at: "2026-09-25T12:00:00.000Z",
    },
  },
};
const verified = {
  authState: {
    id: "auth-state-1",
    targetUserId: null,
    redirectTo: "/cabinet",
  },
  identity: {
    telegramId: "1001",
    telegramUsername: "tester",
    fullName: "Test User",
    photoUrl: "https://img.test/telegram.png",
    providerSession,
  },
};
const consumed = {
  user: {
    id: "user-1",
    upstreamAccountId: "provider-user-1",
    email: "user@example.test",
    emailVerified: true,
    telegramId: "1001",
  },
  redirectTo: "/cabinet",
  providerSession,
  linked: false,
  telegramId: "1001",
  telegramUsername: "tester",
  mergeConfirmation: { required: true, token: "merge-token" },
};
const providerOutcome = {
  redirectTo: "/cabinet",
  session: {
    userId: "user-1",
    remnashopSession: {
      accessTokenEncrypted: "encrypted-access-token",
      refreshTokenEncrypted: "encrypted-refresh-token",
      accessExpiresAt: new Date("2026-08-25T12:15:00.000Z"),
      refreshExpiresAt: new Date("2026-09-25T12:00:00.000Z"),
    },
    requiresTelegramRecovery: false,
  },
  audit: { userId: "user-1", remnashopLinked: true },
};

function encryptedCheckpoint(phase: string, value: unknown) {
  return encryptKeyringSecret(
    JSON.stringify({ version: 2, phase, value }),
    keyring,
    "telegram-oidc-callback-result",
  );
}

function loadedRecord(
  callbackStatus: string,
  callbackResultEncrypted: string,
  overrides: Record<string, unknown> = {},
) {
  return {
    id: "auth-state-1",
    ...proof,
    callbackStatus,
    callbackCodeHash: sha256(code),
    callbackLeaseExpiresAt: new Date(now.getTime() - 1),
    callbackResultEncrypted,
    callbackResultExpiresAt: new Date(now.getTime() + 10 * 60_000),
    callbackWebSessionId: null,
    expiresAt: new Date(now.getTime() + 10 * 60_000),
    ...overrides,
  };
}

describe("durable Telegram callback saga", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.updateMany.mockResolvedValue({ count: 1 });
    mocks.findUnique.mockResolvedValue(null);
    mocks.webSessionFindFirst.mockResolvedValue(null);
    mocks.webSessionUpdateMany.mockResolvedValue({ count: 1 });
    mocks.accountMergeUpdateMany.mockResolvedValue({ count: 1 });
    mocks.queryRaw.mockResolvedValue([{
      id: "auth-state-1",
      expiresAt: new Date(now.getTime() + 10 * 60_000),
    }]);
    mocks.transaction.mockImplementation(
      (run: (tx: unknown) => unknown) => run({
        $queryRaw: mocks.queryRaw,
        telegramAuthState: { updateMany: mocks.updateMany },
        webSession: { updateMany: mocks.webSessionUpdateMany },
        accountMergeConfirmation: {
          updateMany: mocks.accountMergeUpdateMany,
        },
      }),
    );
    mocks.createDurableCallbackWebSession.mockResolvedValue({
      session: { id: "web-session-1" },
      refreshToken: "new-browser-refresh-token",
    });
  });

  it("binds the first durable claim to state, nonce and PKCE cookie hashes", async () => {
    await claimDurableTelegramProviderReady({
      authState: {
        id: "auth-state-1",
        userId: null,
        redirectTo: "/cabinet",
        expiresAt: new Date(now.getTime() + 10 * 60 * 1000),
      },
      proof,
      codeHash: sha256(code),
      now,
    });

    const claim = mocks.updateMany.mock.calls[0]?.[0];
    expect(claim.where).toMatchObject({
      id: "auth-state-1",
      ...proof,
      callbackStatus: "READY",
      consumedAt: null,
    });
    expect(claim.data).toMatchObject({
      callbackStatus: "PROVIDER_READY",
      callbackCodeHash: sha256(code),
      callbackAttemptCount: { increment: 1 },
    });
    expect(claim.data.callbackResultEncrypted).toMatch(
      /^v2\.callback-key-b\.[A-Za-z0-9_-]{22}\./,
    );
    expect(claim.data.callbackResultEncrypted).not.toContain("/cabinet");
    expect(claim.data.callbackResultExpiresAt).toEqual(
      new Date(now.getTime() + 10 * 60 * 1000),
    );
  });

  it("replays the exact completed session only with all original cookie proofs", async () => {
    await completeDurableTelegramSession(ownership, replay, now);
    const completion = mocks.updateMany.mock.calls[0]?.[0];
    expect(completion.data.callbackResultEncrypted).toMatch(
      /^v2\.callback-key-b\.[A-Za-z0-9_-]{22}\./,
    );
    expect(completion.data.callbackResultEncrypted).not.toContain("user-1");
    expect(completion.data.callbackResultExpiresAt).toEqual(
      new Date(now.getTime() + 10 * 60 * 1000),
    );

    mocks.findUnique.mockResolvedValue({
      id: "auth-state-1",
      ...proof,
      callbackStatus: "COMPLETED",
      callbackCodeHash: sha256(code),
      callbackLeaseExpiresAt: null,
      callbackResultEncrypted: completion.data.callbackResultEncrypted,
      callbackResultExpiresAt: completion.data.callbackResultExpiresAt,
    });
    await expect(
      loadDurableTelegramCallback(state, code, proof, now),
    ).resolves.toEqual({ status: "completed", outcome: replay });

    await expect(
      loadDurableTelegramCallback(
        state,
        code,
        { ...proof, nonceHash: sha256("attacker-nonce") },
        now,
      ),
    ).resolves.toEqual({ status: "none" });
  });

  it("atomically renews exact-session access through the full late replay tail", async () => {
    const lateCompletion = new Date(now.getTime() + 19 * 60_000 + 59_000);

    await completeDurableTelegramSession(ownership, replay, lateCompletion);

    expect(mocks.webSessionUpdateMany).toHaveBeenCalledWith({
      where: {
        id: "web-session-1",
        userId: "user-1",
        refreshTokenHash: sha256("new-browser-refresh-token"),
        revokedAt: null,
        refreshExpiresAt: { gt: lateCompletion },
      },
      data: {
        accessTokenExpiresAt: new Date(
          lateCompletion.getTime() + 15 * 60_000,
        ),
      },
    });
    expect(mocks.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        callbackStatus: "COMPLETED",
        callbackResultExpiresAt: new Date(
          lateCompletion.getTime() + 10 * 60_000,
        ),
      }),
    }));
  });

  it("extends the exact merge token beyond the last durable replay cookie", async () => {
    const mergeOutcome = {
      redirectTo: "/link-account",
      mergeConfirmation: { token: "durable-merge-token" },
      audit: { userId: "user-1", remnashopLinked: false },
    };

    await completeDurableTelegramMerge(ownership, mergeOutcome, now);

    expect(mocks.accountMergeUpdateMany).toHaveBeenCalledWith({
      where: {
        userId: "user-1",
        tokenHash: sha256("durable-merge-token"),
        status: { in: ["PENDING", "PROCESSING"] },
      },
      data: {
        expiresAt: new Date(now.getTime() + 20 * 60_000),
      },
    });
    expect(mocks.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        callbackStatus: "COMPLETED",
        callbackResultExpiresAt: new Date(now.getTime() + 10 * 60_000),
      }),
    }));
  });

  it("returns a bounded recovery failure after the durable result expires", async () => {
    mocks.findUnique.mockResolvedValue({
      id: "auth-state-1",
      ...proof,
      callbackStatus: "COMPLETED",
      callbackCodeHash: sha256(code),
      callbackLeaseExpiresAt: null,
      callbackResultEncrypted: "not-read-after-expiry",
      callbackResultExpiresAt: new Date(now.getTime() - 1),
    });

    await expect(loadDurableTelegramCallback(state, code, proof, now))
      .resolves.toEqual({
        status: "failed",
        redirectTo: "/login?auth=telegram_recovery_required",
      });
    expect(mocks.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        callbackResultEncrypted: null,
        callbackClaimTokenHash: null,
        callbackLeaseExpiresAt: null,
      }),
    }));
  });

  it("revokes an unfinished exact session when its checkpoint expires inline", async () => {
    mocks.findUnique.mockResolvedValue({
      id: "auth-state-1",
      ...proof,
      callbackStatus: "SESSION_CREATED",
      callbackCodeHash: sha256(code),
      callbackLeaseExpiresAt: new Date(now.getTime() - 1),
      callbackResultEncrypted: "expired-session-checkpoint",
      callbackResultExpiresAt: new Date(now.getTime() - 1),
      callbackWebSessionId: "web-session-1",
      expiresAt: new Date(now.getTime() + 10 * 60_000),
    });

    await expect(loadDurableTelegramCallback(state, code, proof, now))
      .resolves.toMatchObject({ status: "failed" });

    expect(mocks.webSessionUpdateMany).toHaveBeenCalledWith({
      where: { id: "web-session-1", revokedAt: null },
      data: expect.objectContaining({
        revokedAt: now,
        accessTokenExpiresAt: now,
        refreshExpiresAt: now,
      }),
    });
    expect(mocks.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        callbackResultEncrypted: null,
        callbackWebSessionId: null,
      }),
    }));
  });

  it("terminally fences an active lease at the absolute callback deadline", async () => {
    mocks.findUnique.mockResolvedValue({
      id: "auth-state-1",
      ...proof,
      callbackStatus: "IDENTITY_RESOLVED",
      callbackCodeHash: sha256(code),
      callbackLeaseExpiresAt: new Date(now.getTime() + 60_000),
      callbackResultEncrypted: "opaque-active-checkpoint",
      callbackResultExpiresAt: new Date(now.getTime() + 10 * 60_000),
      callbackWebSessionId: null,
      expiresAt: new Date(now.getTime() - 10 * 60_000),
    });

    await expect(loadDurableTelegramCallback(state, code, proof, now))
      .resolves.toEqual({
        status: "failed",
        redirectTo: "/login?auth=telegram_recovery_required",
      });

    expect(mocks.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        callbackStatus: "IDENTITY_RESOLVED",
        expiresAt: { lte: new Date(now.getTime() - 10 * 60_000) },
      }),
      data: expect.objectContaining({
        callbackStatus: "FAILED",
        callbackFailureCode: "CALLBACK_DEADLINE_EXCEEDED",
      }),
    }));
  });

  it("never re-dispatches an ambiguous one-time provider code", async () => {
    await markDurableTelegramProviderDispatching(
      ownership,
      {
        id: "auth-state-1",
        targetUserId: null,
        redirectTo: "/cabinet",
      },
      new Date(now.getTime() - 3 * 60 * 1000),
    );
    const dispatch = mocks.updateMany.mock.calls[0]?.[0];
    mocks.findUnique.mockResolvedValue({
      id: "auth-state-1",
      ...proof,
      callbackStatus: "PROVIDER_DISPATCHING",
      callbackCodeHash: sha256(code),
      callbackLeaseExpiresAt: new Date(now.getTime() - 1),
      callbackResultEncrypted: dispatch.data.callbackResultEncrypted,
      callbackResultExpiresAt: new Date(now.getTime() + 60_000),
      expiresAt: new Date(now.getTime() + 10 * 60_000),
    });

    await expect(
      loadDurableTelegramCallback(state, code, proof, now),
    ).resolves.toEqual({
      status: "failed",
      redirectTo: "/login?auth=telegram_recovery_required",
    });
    expect(mocks.updateMany).toHaveBeenLastCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        callbackStatus: "PROVIDER_DISPATCHING",
      }),
      data: expect.objectContaining({
        callbackStatus: "FAILED",
        callbackFailureCode: "OIDC_CODE_EXCHANGE_AMBIGUOUS",
      }),
    }));
  });

  it("never re-dispatches an ambiguous Remnashop authentication", async () => {
    await markDurableTelegramRemnashopDispatching(
      ownership,
      {
        authState: {
          id: "auth-state-1",
          targetUserId: null,
          redirectTo: "/cabinet",
        },
        identity: {
          telegramId: "1001",
          telegramUsername: "tester",
          fullName: "Test User",
          photoUrl: null,
          providerSession: null,
        },
      },
      new Date(now.getTime() - 3 * 60 * 1000),
    );
    const dispatch = mocks.updateMany.mock.calls[0]?.[0];
    mocks.findUnique.mockResolvedValue({
      id: "auth-state-1",
      ...proof,
      callbackStatus: "REMNASHOP_DISPATCHING",
      callbackCodeHash: sha256(code),
      callbackLeaseExpiresAt: new Date(now.getTime() - 1),
      callbackResultEncrypted: dispatch.data.callbackResultEncrypted,
      callbackResultExpiresAt: new Date(now.getTime() + 60_000),
      expiresAt: new Date(now.getTime() + 10 * 60_000),
    });

    await expect(
      loadDurableTelegramCallback(state, code, proof, now),
    ).resolves.toEqual({
      status: "failed",
      redirectTo: "/login?auth=telegram_recovery_required",
    });
    expect(mocks.updateMany).toHaveBeenLastCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        callbackStatus: "FAILED",
        callbackFailureCode: "REMNASHOP_AUTH_AMBIGUOUS",
      }),
    }));
  });

  it("revokes the exact session instead of re-dispatching ambiguous recovery", async () => {
    await markDurableTelegramRecoveryDispatching(
      ownership,
      replay,
      new Date(now.getTime() - 3 * 60_000),
    );
    const dispatch = mocks.updateMany.mock.calls[0]?.[0];
    mocks.findUnique.mockResolvedValue({
      id: "auth-state-1",
      ...proof,
      callbackStatus: "RECOVERY_DISPATCHING",
      callbackCodeHash: sha256(code),
      callbackLeaseExpiresAt: new Date(now.getTime() - 1),
      callbackResultEncrypted: dispatch.data.callbackResultEncrypted,
      callbackResultExpiresAt: new Date(now.getTime() + 60_000),
      callbackWebSessionId: "web-session-1",
      expiresAt: new Date(now.getTime() + 10 * 60_000),
    });

    await expect(loadDurableTelegramCallback(state, code, proof, now))
      .resolves.toEqual({
        status: "failed",
        redirectTo: "/login?auth=telegram_recovery_required",
      });

    expect(mocks.webSessionFindFirst).toHaveBeenCalledOnce();
    expect(mocks.webSessionUpdateMany).toHaveBeenCalledWith({
      where: { id: "web-session-1", revokedAt: null },
      data: expect.objectContaining({
        revokedAt: now,
        remnashopAccessTokenEncrypted: null,
      }),
    });
    expect(mocks.updateMany).toHaveBeenLastCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        callbackStatus: "FAILED",
        callbackFailureCode: "REMNASHOP_RECOVERY_AMBIGUOUS",
        callbackWebSessionId: null,
      }),
    }));
  });

  it("resumes committed recovery without another provider dispatch", async () => {
    await markDurableTelegramRecoveryDispatching(
      ownership,
      replay,
      new Date(now.getTime() - 3 * 60_000),
    );
    const dispatch = mocks.updateMany.mock.calls[0]?.[0];
    mocks.findUnique.mockResolvedValue({
      id: "auth-state-1",
      ...proof,
      callbackStatus: "RECOVERY_DISPATCHING",
      callbackCodeHash: sha256(code),
      callbackLeaseExpiresAt: new Date(now.getTime() - 1),
      callbackResultEncrypted: dispatch.data.callbackResultEncrypted,
      callbackResultExpiresAt: new Date(now.getTime() + 60_000),
      callbackWebSessionId: "web-session-1",
      expiresAt: new Date(now.getTime() + 10 * 60_000),
    });
    mocks.webSessionFindFirst.mockResolvedValue({ id: "web-session-1" });

    await expect(loadDurableTelegramCallback(state, code, proof, now))
      .resolves.toMatchObject({
        status: "resume",
        checkpoint: {
          phase: "SESSION_CREATED",
          replay: {
            session: {
              webSessionId: "web-session-1",
              requiresTelegramRecovery: false,
            },
          },
        },
      });

    expect(mocks.webSessionUpdateMany).not.toHaveBeenCalled();
    expect(mocks.updateMany).toHaveBeenLastCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        callbackStatus: "RECOVERY_DISPATCHING",
      }),
      data: expect.objectContaining({
        callbackStatus: "SESSION_CREATED",
      }),
    }));
  });

  it("creates WebSession and SESSION_CREATED inside the same transaction", async () => {
    const created = await createDurableTelegramCallbackSession(
      ownership,
      outcome,
      now,
    );

    expect(mocks.createDurableCallbackWebSession).toHaveBeenCalledTimes(1);
    expect(mocks.createDurableCallbackWebSession.mock.invocationCallOrder[0])
      .toBeLessThan(mocks.updateMany.mock.invocationCallOrder[0]);
    expect(mocks.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ callbackStatus: "OUTCOME_READY" }),
      data: expect.objectContaining({ callbackStatus: "SESSION_CREATED" }),
    }));
    expect(created.replay).toEqual(replay);
    expect(created.replay.session?.bootstrapRefreshToken).toBe(
      "new-browser-refresh-token",
    );
  });

  it("fails the transaction when the SESSION_CREATED ownership CAS loses", async () => {
    mocks.updateMany.mockResolvedValueOnce({ count: 0 });

    await expect(
      createDurableTelegramCallbackSession(ownership, outcome, now),
    ).rejects.toThrow("session commit ownership changed");
  });

  it("keeps a second worker out after work exceeds the nominal lease", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(now);
    let finish!: () => void;
    const work = new Promise<void>((resolve) => {
      finish = resolve;
    });
    try {
      await checkpointDurableTelegramIdentityResolved(
        ownership,
        {
          user: {
            id: "user-1",
            upstreamAccountId: null,
            email: "user@example.test",
            emailVerified: true,
            telegramId: "1001",
          },
          redirectTo: "/cabinet",
          providerSession: null,
          linked: false,
          telegramId: "1001",
          telegramUsername: "tester",
          mergeConfirmation: null,
        },
        now,
      );
      const checkpoint = mocks.updateMany.mock.calls[0]?.[0];
      const record = {
        id: "auth-state-1",
        ...proof,
        expiresAt: new Date(now.getTime() + 10 * 60_000),
        callbackStatus: "IDENTITY_RESOLVED",
        callbackCodeHash: sha256(code),
        callbackLeaseExpiresAt: new Date(now.getTime() + 2 * 60_000),
        callbackResultEncrypted: checkpoint.data.callbackResultEncrypted,
        callbackResultExpiresAt: new Date(now.getTime() + 10 * 60_000),
      };
      mocks.findUnique.mockImplementation(async () => ({ ...record }));
      mocks.updateMany.mockImplementation(async ({ where, data }) => {
        if (
          where.callbackClaimTokenHash === sha256(ownership.claimToken)
          && data.callbackLeaseExpiresAt instanceof Date
        ) {
          record.callbackLeaseExpiresAt = data.callbackLeaseExpiresAt;
          return { count: 1 };
        }
        return { count: 0 };
      });
      const running = runWithDurableTelegramCallbackLease(
        ownership,
        "IDENTITY_RESOLVED",
        () => work,
        { heartbeatMs: 30_000 },
      );
      await vi.advanceTimersByTimeAsync(2 * 60_000 + 1_000);

      await expect(loadDurableTelegramCallback(
        state,
        code,
        proof,
        new Date(),
      )).resolves.toEqual({ status: "processing" });
      finish();
      await running;

      expect(mocks.updateMany.mock.calls.length).toBeGreaterThanOrEqual(4);
      expect(mocks.updateMany).toHaveBeenCalledWith(expect.objectContaining({
        where: expect.objectContaining({
          callbackStatus: "IDENTITY_RESOLVED",
          callbackClaimTokenHash: sha256(ownership.claimToken),
        }),
        data: expect.objectContaining({
          callbackLeaseExpiresAt: expect.any(Date),
          callbackResultExpiresAt: expect.any(Date),
        }),
      }));
    } finally {
      vi.useRealTimers();
    }
  });

  it("does not invoke work when the initial lease renewal loses ownership", async () => {
    mocks.updateMany.mockResolvedValueOnce({ count: 0 });
    const work = vi.fn(async () => "must-not-run");

    await expect(runWithDurableTelegramCallbackLease(
      ownership,
      "IDENTITY_RESOLVED",
      work,
    )).rejects.toMatchObject({
      name: "DurableTelegramCallbackClaimConflictError",
    });

    expect(work).not.toHaveBeenCalled();
    expect(mocks.recordOperationalEvent).toHaveBeenCalledWith(
      "telegram_callback_lease_ownership_lost",
    );
  });

  it("round-trips every resumable phase and normalizes provider expiries", async () => {
    const checkpoints: Array<[string, string]> = [];

    await claimDurableTelegramProviderReady({
      authState: {
        id: "auth-state-1",
        userId: null,
        redirectTo: "/cabinet",
        expiresAt: new Date(now.getTime() + 10 * 60_000),
      },
      proof,
      codeHash: sha256(code),
      now,
    });
    checkpoints.push([
      "PROVIDER_READY",
      mocks.updateMany.mock.calls.at(-1)?.[0].data.callbackResultEncrypted,
    ]);

    await checkpointDurableTelegramIdentity(ownership, verified, now);
    checkpoints.push([
      "IDENTITY_VERIFIED",
      mocks.updateMany.mock.calls.at(-1)?.[0].data.callbackResultEncrypted,
    ]);

    await checkpointDurableTelegramProvider(ownership, verified, now);
    checkpoints.push([
      "PROVIDER_AUTHENTICATED",
      mocks.updateMany.mock.calls.at(-1)?.[0].data.callbackResultEncrypted,
    ]);

    await checkpointDurableTelegramIdentityResolved(ownership, consumed, now);
    checkpoints.push([
      "IDENTITY_RESOLVED",
      mocks.updateMany.mock.calls.at(-1)?.[0].data.callbackResultEncrypted,
    ]);

    await checkpointDurableTelegramOutcome(ownership, providerOutcome, now);
    checkpoints.push([
      "OUTCOME_READY",
      mocks.updateMany.mock.calls.at(-1)?.[0].data.callbackResultEncrypted,
    ]);

    await createDurableTelegramCallbackSession(ownership, outcome, now);
    checkpoints.push([
      "SESSION_CREATED",
      mocks.updateMany.mock.calls.at(-1)?.[0].data.callbackResultEncrypted,
    ]);

    for (const [phase, encrypted] of checkpoints) {
      mocks.findUnique.mockResolvedValueOnce(loadedRecord(phase, encrypted));
      const result = await loadDurableTelegramCallback(state, code, proof, now);
      expect(result).toMatchObject({
        status: "resume",
        checkpoint: { phase },
      });
      if (
        result.status === "resume"
        && result.checkpoint.phase === "OUTCOME_READY"
      ) {
        expect(result.checkpoint.outcome.session?.remnashopSession).toMatchObject({
          accessExpiresAt: new Date("2026-08-25T12:15:00.000Z"),
          refreshExpiresAt: new Date("2026-09-25T12:00:00.000Z"),
        });
      }
    }
  });

  it("rewraps resumable and completed checkpoints encrypted by the previous key", async () => {
    const previousKeyring = { primary: oldKeyringEntry, previous: [] };
    const oldProviderReady = encryptKeyringSecret(
      JSON.stringify({
        version: 2,
        phase: "PROVIDER_READY",
        value: { authState: { id: "auth-state-1" } },
      }),
      previousKeyring,
      "telegram-oidc-callback-result",
    );
    mocks.findUnique.mockResolvedValueOnce(
      loadedRecord("PROVIDER_READY", oldProviderReady),
    );

    await expect(loadDurableTelegramCallback(state, code, proof, now))
      .resolves.toMatchObject({ status: "resume" });
    expect(mocks.updateMany).toHaveBeenLastCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        callbackResultEncrypted: expect.stringMatching(/^v2\.callback-key-b\./),
      }),
    }));

    const oldCompletion = encryptKeyringSecret(
      JSON.stringify({ version: 2, phase: "COMPLETED", value: replay }),
      previousKeyring,
      "telegram-oidc-callback-result",
    );
    mocks.findUnique.mockResolvedValueOnce(
      loadedRecord("COMPLETED", oldCompletion),
    );
    await expect(loadDurableTelegramCallback(state, code, proof, now))
      .resolves.toEqual({ status: "completed", outcome: replay });

    expect(mocks.recordOperationalEvent).toHaveBeenCalledTimes(2);
    expect(mocks.recordOperationalEvent).toHaveBeenCalledWith(
      "encrypted_telegram_callback_result_rewrapped",
    );
  });

  it.each([
    ["PROVIDER_READY", { nope: true }, "provider-ready checkpoint"],
    ["PROVIDER_READY", { authState: { id: "" } }, "provider-ready auth state"],
    ["IDENTITY_VERIFIED", { authState: {} }, "verified Telegram callback"],
    [
      "IDENTITY_VERIFIED",
      { ...verified, identity: { ...verified.identity, telegramId: "" } },
      "verified Telegram identity",
    ],
    [
      "IDENTITY_VERIFIED",
      { ...verified, identity: { ...verified.identity, providerSession: {} } },
      "provider session",
    ],
    [
      "IDENTITY_VERIFIED",
      {
        ...verified,
        identity: { ...verified.identity, providerSession: { context: {} } },
      },
      "provider session context",
    ],
    [
      "IDENTITY_VERIFIED",
      {
        ...verified,
        identity: {
          ...verified.identity,
          providerSession: {
            context: { cookies: {}, data: {} },
          },
        },
      },
      "provider credentials",
    ],
    ["IDENTITY_RESOLVED", { linked: false }, "consumed Telegram callback"],
    [
      "IDENTITY_RESOLVED",
      { ...consumed, user: { ...consumed.user, emailVerified: "yes" } },
      "consumed Telegram identity",
    ],
    [
      "IDENTITY_RESOLVED",
      { ...consumed, mergeConfirmation: { required: true, token: "" } },
      "merge checkpoint",
    ],
    ["OUTCOME_READY", { redirectTo: "/cabinet" }, "callback outcome"],
    [
      "OUTCOME_READY",
      { ...providerOutcome, audit: { userId: "", remnashopLinked: true } },
      "callback audit outcome",
    ],
    [
      "OUTCOME_READY",
      { ...providerOutcome, mergeConfirmation: { token: "" } },
      "merge outcome",
    ],
    [
      "OUTCOME_READY",
      { ...providerOutcome, session: { userId: "user-1" } },
      "session outcome",
    ],
    [
      "OUTCOME_READY",
      {
        ...providerOutcome,
        session: { ...providerOutcome.session, remnashopSession: {} },
      },
      "stored provider outcome",
    ],
    [
      "OUTCOME_READY",
      {
        ...providerOutcome,
        session: {
          ...providerOutcome.session,
          remnashopSession: {
            ...providerOutcome.session.remnashopSession,
            accessExpiresAt: "not-a-date",
          },
        },
      },
      "provider expiry",
    ],
    [
      "OUTCOME_READY",
      { redirectTo: "/cabinet", audit: providerOutcome.audit },
      "one bootstrap result",
    ],
    ["SESSION_CREATED", { redirectTo: "/cabinet" }, "durable Telegram replay"],
    [
      "SESSION_CREATED",
      { ...replay, audit: { userId: "", remnashopLinked: true } },
      "replay audit",
    ],
    [
      "SESSION_CREATED",
      { ...replay, session: { userId: "user-1" } },
      "replay session",
    ],
    [
      "SESSION_CREATED",
      { ...replay, mergeConfirmation: { token: "" } },
      "replay merge confirmation",
    ],
    [
      "SESSION_CREATED",
      { redirectTo: "/cabinet", audit: replay.audit },
      "one bootstrap result",
    ],
  ])("rejects tampered %s checkpoint payload %#", async (
    phase,
    value,
    message,
  ) => {
    mocks.findUnique.mockResolvedValue(
      loadedRecord(phase, encryptedCheckpoint(phase, value)),
    );
    await expect(loadDurableTelegramCallback(state, code, proof, now))
      .rejects.toThrow(message);
  });

  it("rejects malformed envelopes and phase substitution", async () => {
    const malformed = encryptKeyringSecret(
      JSON.stringify({ version: 1, phase: "PROVIDER_READY", value: {} }),
      keyring,
      "telegram-oidc-callback-result",
    );
    mocks.findUnique.mockResolvedValueOnce(
      loadedRecord("PROVIDER_READY", malformed),
    );
    await expect(loadDurableTelegramCallback(state, code, proof, now))
      .rejects.toThrow("checkpoint envelope");

    mocks.findUnique.mockResolvedValueOnce(loadedRecord(
      "PROVIDER_READY",
      encryptedCheckpoint("IDENTITY_VERIFIED", verified),
    ));
    await expect(loadDurableTelegramCallback(state, code, proof, now))
      .rejects.toThrow("phase mismatch");

    mocks.findUnique.mockResolvedValueOnce(loadedRecord(
      "COMPLETED",
      encryptedCheckpoint("FAILED", { redirectTo: "/login" }),
    ));
    await expect(loadDurableTelegramCallback(state, code, proof, now))
      .rejects.toThrow("completion phase mismatch");
  });

  it("covers transition guards, CAS conflicts, release and checkpoint bounds", async () => {
    mocks.updateMany.mockResolvedValueOnce({ count: 0 });
    await expect(claimDurableTelegramProviderReady({
      authState: {
        id: "auth-state-1",
        userId: null,
        redirectTo: null,
        expiresAt: new Date(now.getTime() + 60_000),
      },
      proof,
      codeHash: sha256(code),
      now,
    })).rejects.toMatchObject({
      name: "DurableTelegramCallbackClaimConflictError",
    });

    mocks.updateMany.mockResolvedValueOnce({ count: 0 });
    await expect(checkpointDurableTelegramIdentity(
      ownership,
      verified,
      now,
    )).rejects.toThrow("ownership changed");

    expect(() => markDurableTelegramRecoveryDispatching(
      ownership,
      { redirectTo: "/login", mergeConfirmation: { token: "token" }, audit: replay.audit },
      now,
    )).toThrow("has no exact session");
    expect(() => checkpointDurableTelegramRecoveryCommitted(
      ownership,
      { redirectTo: "/login", mergeConfirmation: { token: "token" }, audit: replay.audit },
      now,
    )).toThrow("has no exact session");

    await expect(checkpointDurableTelegramRecoveryCommitted(
      ownership,
      replay,
      now,
    )).resolves.toMatchObject({
      session: { requiresTelegramRecovery: false },
    });

    await releaseDurableTelegramCallback(ownership, "SESSION_CREATED", now);
    expect(mocks.updateMany).toHaveBeenLastCalledWith({
      where: expect.objectContaining({
        callbackStatus: "SESSION_CREATED",
        callbackClaimTokenHash: sha256(ownership.claimToken),
      }),
      data: { callbackClaimTokenHash: null, callbackLeaseExpiresAt: now },
    });

    await expect(markDurableTelegramProviderDispatching(
      ownership,
      {
        id: "auth-state-1",
        targetUserId: null,
        redirectTo: "x".repeat(300 * 1024),
      },
      now,
    )).rejects.toThrow("checkpoint is too large");
  });

  it("rejects invalid session and merge completion states atomically", async () => {
    await expect(createDurableTelegramCallbackSession(
      ownership,
      {
        redirectTo: "/merge",
        mergeConfirmation: { token: "token" },
        audit: replay.audit,
      },
      now,
    )).rejects.toThrow("requires a session outcome");

    mocks.queryRaw.mockResolvedValueOnce([]);
    await expect(createDurableTelegramCallbackSession(ownership, outcome, now))
      .rejects.toThrow("state disappeared");

    mocks.createDurableCallbackWebSession.mockResolvedValueOnce({
      session: { id: "web-session-1" },
      refreshToken: "",
    });
    await expect(createDurableTelegramCallbackSession(ownership, outcome, now))
      .rejects.toThrow("missing session bootstrap credentials");

    await expect(completeDurableTelegramSession(
      ownership,
      { redirectTo: "/merge", mergeConfirmation: { token: "token" }, audit: replay.audit },
      now,
    )).rejects.toThrow("has no session");

    mocks.updateMany.mockResolvedValueOnce({ count: 0 });
    await expect(completeDurableTelegramSession(ownership, replay, now))
      .rejects.toThrow("completion ownership changed");

    mocks.webSessionUpdateMany.mockResolvedValueOnce({ count: 0 });
    await expect(completeDurableTelegramSession(ownership, replay, now))
      .rejects.toThrow("exact session is not replayable");

    await expect(completeDurableTelegramMerge(ownership, outcome, now))
      .rejects.toThrow("has no merge outcome");

    const mergeOutcome = {
      redirectTo: "/merge",
      mergeConfirmation: { token: "merge-token" },
      audit: { userId: "user-1", remnashopLinked: false },
    };
    mocks.accountMergeUpdateMany.mockResolvedValueOnce({ count: 0 });
    await expect(completeDurableTelegramMerge(ownership, mergeOutcome, now))
      .rejects.toThrow("merge confirmation is not replayable");

    mocks.updateMany.mockResolvedValueOnce({ count: 0 });
    await expect(completeDurableTelegramMerge(ownership, mergeOutcome, now))
      .rejects.toThrow("merge completion ownership changed");
  });

  it("persists bounded failures and revokes only the exact unfinished session", async () => {
    mocks.queryRaw.mockResolvedValueOnce([]);
    await expect(failDurableTelegramCallback(
      ownership,
      "SESSION_CREATED",
      "MISSING",
      "/login",
      replay,
      now,
    )).rejects.toThrow("state disappeared before failure commit");

    const longFailureCode = "F".repeat(200);
    await failDurableTelegramCallback(
      ownership,
      "SESSION_CREATED",
      longFailureCode,
      "/login?auth=failed",
      replay,
      now,
    );
    expect(mocks.webSessionUpdateMany).toHaveBeenLastCalledWith({
      where: {
        id: "web-session-1",
        userId: "user-1",
        revokedAt: null,
      },
      data: expect.objectContaining({
        revokedAt: now,
        remnashopAccessTokenEncrypted: null,
      }),
    });
    expect(mocks.updateMany).toHaveBeenLastCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        callbackStatus: "FAILED",
        callbackFailureCode: "F".repeat(128),
        callbackResultEncrypted: expect.any(String),
        callbackWebSessionId: null,
      }),
    }));

    mocks.queryRaw.mockResolvedValueOnce([{
      id: "auth-state-1",
      expiresAt: new Date(now.getTime() - 20 * 60_000),
    }]);
    await failDurableTelegramCallback(
      ownership,
      "IDENTITY_RESOLVED",
      "EXPIRED",
      "/login",
      undefined,
      now,
    );
    expect(mocks.updateMany).toHaveBeenLastCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        callbackResultEncrypted: null,
        callbackResultExpiresAt: now,
      }),
    }));

    mocks.updateMany.mockResolvedValueOnce({ count: 0 });
    await expect(failDurableTelegramCallback(
      ownership,
      "IDENTITY_RESOLVED",
      "CAS_LOST",
      "/login",
      undefined,
      now,
    )).rejects.toThrow("failure ownership changed");
  });

  it("propagates work errors and detects a rejected heartbeat renewal", async () => {
    const workFailure = new Error("work failed");
    await expect(runWithDurableTelegramCallbackLease(
      ownership,
      "IDENTITY_RESOLVED",
      async () => {
        throw workFailure;
      },
      { now: () => now },
    )).rejects.toBe(workFailure);

    vi.useFakeTimers();
    vi.setSystemTime(now);
    let finish!: () => void;
    const work = new Promise<void>((resolve) => {
      finish = resolve;
    });
    mocks.updateMany
      .mockResolvedValueOnce({ count: 1 })
      .mockRejectedValueOnce(new Error("database unavailable"));
    try {
      const running = runWithDurableTelegramCallbackLease(
        ownership,
        "IDENTITY_RESOLVED",
        () => work,
        { heartbeatMs: 1_000, now: () => new Date() },
      );
      await vi.advanceTimersByTimeAsync(1_000);
      finish();
      await expect(running).rejects.toMatchObject({
        name: "DurableTelegramCallbackClaimConflictError",
      });
      expect(mocks.recordOperationalEvent).toHaveBeenCalledWith(
        "telegram_callback_lease_ownership_lost",
      );
    } finally {
      vi.useRealTimers();
    }
  });

  it("returns stable states when concurrent terminalization or resume CAS loses", async () => {
    await expect(loadDurableTelegramCallback(
      "wrong-state",
      code,
      proof,
      now,
    )).resolves.toEqual({ status: "none" });

    mocks.findUnique.mockResolvedValueOnce(loadedRecord(
      "COMPLETED",
      "ignored-empty-result",
      {
        callbackResultEncrypted: null,
        callbackResultExpiresAt: null,
      },
    ));
    await expect(loadDurableTelegramCallback(state, code, proof, now))
      .resolves.toEqual({
        status: "failed",
        redirectTo: "/login?auth=telegram_recovery_required",
      });

    mocks.findUnique.mockResolvedValueOnce(loadedRecord(
      "FAILED",
      encryptedCheckpoint("FAILED", { redirectTo: "/login?auth=failed" }),
    ));
    await expect(loadDurableTelegramCallback(state, code, proof, now))
      .resolves.toEqual({
        status: "failed",
        redirectTo: "/login?auth=failed",
      });

    mocks.findUnique.mockResolvedValueOnce(loadedRecord(
      "FAILED",
      encryptedCheckpoint("FAILED", { redirectTo: "" }),
    ));
    await expect(loadDurableTelegramCallback(state, code, proof, now))
      .rejects.toThrow("failure checkpoint");

    mocks.findUnique.mockResolvedValueOnce(loadedRecord(
      "IDENTITY_RESOLVED",
      encryptedCheckpoint("IDENTITY_RESOLVED", consumed),
      { expiresAt: new Date(now.getTime() - 10 * 60_000) },
    ));
    mocks.updateMany.mockResolvedValueOnce({ count: 0 });
    await expect(loadDurableTelegramCallback(state, code, proof, now))
      .resolves.toEqual({ status: "processing" });

    mocks.findUnique.mockResolvedValueOnce(loadedRecord(
      "RECOVERY_DISPATCHING",
      encryptedCheckpoint("RECOVERY_DISPATCHING", replay),
      { callbackLeaseExpiresAt: new Date(now.getTime() + 1_000) },
    ));
    await expect(loadDurableTelegramCallback(state, code, proof, now))
      .resolves.toEqual({ status: "processing" });

    mocks.findUnique.mockResolvedValueOnce(loadedRecord(
      "PROVIDER_DISPATCHING",
      encryptedCheckpoint("PROVIDER_DISPATCHING", { authState: verified.authState }),
      { callbackLeaseExpiresAt: new Date(now.getTime() + 1_000) },
    ));
    await expect(loadDurableTelegramCallback(state, code, proof, now))
      .resolves.toEqual({ status: "processing" });

    mocks.findUnique.mockResolvedValueOnce(loadedRecord(
      "READY",
      encryptedCheckpoint("READY", {}),
    ));
    await expect(loadDurableTelegramCallback(state, code, proof, now))
      .resolves.toEqual({ status: "none" });

    mocks.findUnique.mockResolvedValueOnce(loadedRecord(
      "OUTCOME_READY",
      encryptedCheckpoint("OUTCOME_READY", outcome),
      { callbackLeaseExpiresAt: new Date(now.getTime() + 1_000) },
    ));
    await expect(loadDurableTelegramCallback(state, code, proof, now))
      .resolves.toEqual({ status: "processing" });

    mocks.findUnique.mockResolvedValueOnce(loadedRecord(
      "OUTCOME_READY",
      encryptedCheckpoint("OUTCOME_READY", outcome),
    ));
    mocks.updateMany.mockResolvedValueOnce({ count: 0 });
    await expect(loadDurableTelegramCallback(state, code, proof, now))
      .resolves.toEqual({ status: "processing" });
  });
});
