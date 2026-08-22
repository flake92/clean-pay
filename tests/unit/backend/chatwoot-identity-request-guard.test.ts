import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  loggerWarn: vi.fn(),
  recordOperationalEvent: vi.fn(),
}));

vi.mock("@/backend/observability/logger", () => ({
  logger: { warn: mocks.loggerWarn },
}));
vi.mock("@/backend/observability/metrics", () => ({
  recordOperationalEvent: mocks.recordOperationalEvent,
}));

import {
  ChatwootIdentityCapacityError,
  createChatwootIdentityRequestGuard,
} from "@/backend/integrations/support/chatwoot-identity-request-guard";

const defaultLimits = {
  globalRateLimit: 100,
  sessionRateLimit: 24,
  rateWindowMs: 60_000,
  globalConcurrencyLimit: 8,
  sessionConcurrencyLimit: 2,
  leaseMs: 10_000,
};

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((complete) => {
    resolve = complete;
  });

  return { promise, resolve };
}

describe("Chatwoot identity request guard", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("uses the configured production limits when none are overridden", async () => {
    const guard = createChatwootIdentityRequestGuard({
      distributedCommand: null,
    });

    await expect(guard.runAction(async () => "confirmed"))
      .resolves.toBe("confirmed");
  });

  it("allows the twelve probes used by a complete browser retry cycle", async () => {
    const guard = createChatwootIdentityRequestGuard({
      distributedCommand: null,
      limits: defaultLimits,
    });
    const work = vi.fn(async () => "confirmed");

    for (let index = 0; index < 12; index += 1) {
      await expect(guard.runAction(() => guard.runProbe({
        sessionId: "session-1",
        conversationToken: `conversation-${index}`,
        work,
      }))).resolves.toBe("confirmed");
    }

    expect(work).toHaveBeenCalledTimes(12);
  });

  it("coalesces concurrent probes for the same session and conversation", async () => {
    const guard = createChatwootIdentityRequestGuard({
      distributedCommand: null,
      limits: defaultLimits,
    });
    const pending = deferred<string>();
    const work = vi.fn(() => pending.promise);
    const first = guard.runProbe({
      sessionId: "session-1",
      conversationToken: "conversation-token",
      work,
    });
    const second = guard.runProbe({
      sessionId: "session-1",
      conversationToken: "conversation-token",
      work,
    });

    await Promise.resolve();
    expect(work).toHaveBeenCalledTimes(1);
    pending.resolve("confirmed");

    await expect(Promise.all([first, second]))
      .resolves.toEqual(["confirmed", "confirmed"]);
    expect(mocks.recordOperationalEvent).toHaveBeenCalledWith(
      "chatwoot_identity_probe_coalesced",
      "session",
    );
  });

  it("bounds global and per-session concurrency", async () => {
    const globalGuard = createChatwootIdentityRequestGuard({
      distributedCommand: null,
      limits: { ...defaultLimits, globalConcurrencyLimit: 1 },
    });
    const globalPending = deferred<void>();
    const firstAction = globalGuard.runAction(() => globalPending.promise);

    await expect(globalGuard.runAction(async () => undefined)).rejects.toEqual(
      expect.objectContaining({
        name: "ChatwootIdentityCapacityError",
        reason: "concurrency_saturated",
        scope: "global",
      }),
    );
    globalPending.resolve();
    await firstAction;

    const sessionGuard = createChatwootIdentityRequestGuard({
      distributedCommand: null,
      limits: { ...defaultLimits, sessionConcurrencyLimit: 1 },
    });
    const sessionPending = deferred<void>();
    const firstProbe = sessionGuard.runProbe({
      sessionId: "session-1",
      conversationToken: "a",
      work: () => sessionPending.promise,
    });

    await expect(sessionGuard.runProbe({
      sessionId: "session-1",
      conversationToken: "b",
      work: async () => undefined,
    })).rejects.toEqual(expect.objectContaining({
      reason: "concurrency_saturated",
      scope: "session",
    }));
    sessionPending.resolve();
    await firstProbe;
  });

  it("rate limits direct per-session replay", async () => {
    const guard = createChatwootIdentityRequestGuard({
      distributedCommand: null,
      limits: { ...defaultLimits, sessionRateLimit: 2 },
    });

    for (let index = 0; index < 2; index += 1) {
      await guard.runProbe({
        sessionId: "session-1",
        conversationToken: `conversation-${index}`,
        work: async () => undefined,
      });
    }

    await expect(guard.runProbe({
      sessionId: "session-1",
      conversationToken: "conversation-replayed",
      work: async () => undefined,
    })).rejects.toBeInstanceOf(ChatwootIdentityCapacityError);
    expect(mocks.recordOperationalEvent).toHaveBeenCalledWith(
      "chatwoot_identity_rate_limited",
      "session",
    );
  });

  it("falls back to local bounds when Redis is unavailable", async () => {
    const redis = vi.fn(async () => {
      throw new Error("redis offline");
    });
    const guard = createChatwootIdentityRequestGuard({
      distributedCommand: redis,
      limits: { ...defaultLimits, globalRateLimit: 2 },
      now: () => 1_000,
    });

    await expect(guard.runAction(async () => "pending"))
      .resolves.toBe("pending");
    await expect(guard.runAction(async () => "pending"))
      .resolves.toBe("pending");
    await expect(guard.runAction(async () => "must-not-run"))
      .rejects.toEqual(expect.objectContaining({
        reason: "rate_limited",
        scope: "global",
      }));
    expect(mocks.recordOperationalEvent).toHaveBeenCalledWith(
      "chatwoot_identity_guard_degraded",
      "redis",
    );
    expect(mocks.loggerWarn).toHaveBeenCalledTimes(1);
  });

  it("resets local windows and decrements overlapping concurrency", async () => {
    let currentTime = 1_000;
    const guard = createChatwootIdentityRequestGuard({
      distributedCommand: null,
      limits: {
        ...defaultLimits,
        globalRateLimit: 2,
        globalConcurrencyLimit: 2,
        rateWindowMs: 100,
      },
      now: () => currentTime,
    });
    const firstPending = deferred<void>();
    const secondPending = deferred<void>();
    const first = guard.runAction(() => firstPending.promise);
    const second = guard.runAction(() => secondPending.promise);

    firstPending.resolve();
    await first;
    secondPending.resolve();
    await second;

    currentTime += 101;
    await expect(guard.runAction(async () => "next-window"))
      .resolves.toBe("next-window");
  });

  it("acquires and releases a distributed concurrency lease", async () => {
    const redis = vi.fn()
      .mockResolvedValueOnce(1)
      .mockResolvedValueOnce(1);
    const guard = createChatwootIdentityRequestGuard({
      distributedCommand: redis,
      limits: defaultLimits,
      now: () => 1_000,
      token: () => "lease-token",
    });

    await expect(guard.runAction(async () => "confirmed"))
      .resolves.toBe("confirmed");
    const acquire = redis.mock.calls[0]?.[0];
    expect(acquire?.slice(0, 3)).toEqual([
      "EVAL",
      expect.stringContaining(
        "redis.call('ZADD', KEYS[2], ARGV[4], ARGV[5])",
      ),
      2,
    ]);
    expect(acquire?.slice(3)).toEqual([
      "clean-pay:rate-limit:v4:auth:chatwoot_identity_probe:capacity",
      "clean-pay:rate-limit:v4:auth:chatwoot_identity_probe:capacity:concurrency",
      60_000,
      100,
      1_000,
      11_000,
      "lease-token",
      8,
      10_000,
    ]);
    expect(redis).toHaveBeenLastCalledWith([
      "ZREM",
      expect.stringContaining(":concurrency"),
      "lease-token",
    ]);
  });

  it("honors a distributed rate or concurrency rejection", async () => {
    const rateLimited = createChatwootIdentityRequestGuard({
      distributedCommand: vi.fn(async () => -1),
      limits: defaultLimits,
    });
    await expect(rateLimited.runAction(async () => undefined)).rejects.toEqual(
      expect.objectContaining({
        reason: "rate_limited",
        scope: "global",
      }),
    );

    const saturated = createChatwootIdentityRequestGuard({
      distributedCommand: vi.fn(async () => 0),
      limits: defaultLimits,
    });
    await expect(saturated.runAction(async () => undefined)).rejects.toEqual(
      expect.objectContaining({
        reason: "concurrency_saturated",
        scope: "global",
      }),
    );
  });

  it("keeps local protection when Redis returns invalid data or release fails", async () => {
    const invalidRedis = createChatwootIdentityRequestGuard({
      distributedCommand: vi.fn(async () => "invalid"),
      limits: defaultLimits,
    });
    await expect(invalidRedis.runAction(async () => "confirmed"))
      .resolves.toBe("confirmed");

    const releaseFailure = vi.fn()
      .mockResolvedValueOnce(1)
      .mockRejectedValueOnce(new Error("release failed"));
    const releaseGuard = createChatwootIdentityRequestGuard({
      distributedCommand: releaseFailure,
      limits: defaultLimits,
    });
    await expect(releaseGuard.runAction(async () => "confirmed"))
      .resolves.toBe("confirmed");

    expect(mocks.recordOperationalEvent).toHaveBeenCalledWith(
      "chatwoot_identity_guard_degraded",
      "redis",
    );
  });
});
