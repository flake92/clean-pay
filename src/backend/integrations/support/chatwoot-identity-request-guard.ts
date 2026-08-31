import { randomUUID } from "node:crypto";

import { redisCommand } from "@/backend/cache/redis";
import { getEnv } from "@/backend/config/env";
import {
  rateLimitCapacityKey,
  rateLimitKey,
} from "@/backend/limits/rate-limit";
import { logger } from "@/backend/observability/logger";
import { recordOperationalEvent } from "@/backend/observability/metrics";
import { sha256 } from "@/backend/security/crypto";

type RedisCommand = typeof redisCommand;

type GuardLimits = {
  globalRateLimit: number;
  sessionRateLimit: number;
  rateWindowMs: number;
  globalConcurrencyLimit: number;
  sessionConcurrencyLimit: number;
  leaseMs: number;
};

type WindowCounter = {
  count: number;
  expiresAt: number;
};

type DistributedLease = {
  key: string;
  token: string;
};

type GuardOptions = {
  distributedCommand?: RedisCommand | null;
  limits?: GuardLimits;
  now?: () => number;
  token?: () => string;
};

const actionName = "chatwoot_identity_probe";
const defaultSessionRateLimit = 24;
const defaultSessionConcurrencyLimit = 2;
const defaultRateWindowMs = 60_000;
const defaultLeaseMs = 10_000;
const redisWarningIntervalMs = 60_000;

const acquireLeaseScript = [
  "local count = redis.call('INCR', KEYS[1])",
  "if count == 1 then redis.call('PEXPIRE', KEYS[1], ARGV[1]) end",
  "if count > tonumber(ARGV[2]) then return -1 end",
  "redis.call('ZREMRANGEBYSCORE', KEYS[2], '-inf', ARGV[3])",
  "if redis.call('ZCARD', KEYS[2]) >= tonumber(ARGV[6]) then return 0 end",
  "redis.call('ZADD', KEYS[2], ARGV[4], ARGV[5])",
  "redis.call('PEXPIRE', KEYS[2], ARGV[7])",
  "return 1",
].join("; ");

export class ChatwootIdentityCapacityError extends Error {
  constructor(
    readonly reason: "rate_limited" | "concurrency_saturated",
    readonly scope: "global" | "session",
  ) {
    super(`Chatwoot identity ${scope} ${reason}`);
    this.name = "ChatwootIdentityCapacityError";
  }
}

function productionLimits(): GuardLimits {
  const env = getEnv();

  return {
    globalRateLimit: env.authRateLimitCapacity,
    sessionRateLimit: defaultSessionRateLimit,
    rateWindowMs: defaultRateWindowMs,
    globalConcurrencyLimit: env.authConcurrencyLimit,
    sessionConcurrencyLimit: defaultSessionConcurrencyLimit,
    leaseMs: defaultLeaseMs,
  };
}

function capacityError(
  reason: ChatwootIdentityCapacityError["reason"],
  scope: ChatwootIdentityCapacityError["scope"],
) {
  recordOperationalEvent(
    reason === "rate_limited"
      ? "chatwoot_identity_rate_limited"
      : "chatwoot_identity_concurrency_saturated",
    scope,
  );
  return new ChatwootIdentityCapacityError(reason, scope);
}

export function createChatwootIdentityRequestGuard(
  options: GuardOptions = {},
) {
  const distributedCommand = options.distributedCommand === null
    ? null
    : options.distributedCommand
      ?? (process.env.REDIS_URL ? redisCommand : null);
  const now = options.now ?? Date.now;
  const nextToken = options.token ?? randomUUID;
  const counters = new Map<string, WindowCounter>();
  const activeByScope = new Map<string, number>();
  const inFlightProbes = new Map<string, Promise<unknown>>();
  let lastRedisWarningAt = Number.NEGATIVE_INFINITY;

  const limits = () => options.limits ?? productionLimits();

  function pruneCounters(currentTime: number) {
    for (const [key, counter] of counters) {
      if (counter.expiresAt <= currentTime) {
        counters.delete(key);
      }
    }
  }

  function consumeLocalRate(
    key: string,
    limit: number,
    scope: ChatwootIdentityCapacityError["scope"],
  ) {
    const currentTime = now();
    let counter = counters.get(key);

    if (!counter || counter.expiresAt <= currentTime) {
      pruneCounters(currentTime);
      counter = {
        count: 0,
        expiresAt: currentTime + limits().rateWindowMs,
      };
      counters.set(key, counter);
    }

    counter.count += 1;
    if (counter.count > limit) {
      throw capacityError("rate_limited", scope);
    }
  }

  function enterLocalConcurrency(
    key: string,
    limit: number,
    scope: ChatwootIdentityCapacityError["scope"],
  ) {
    const active = activeByScope.get(key) ?? 0;

    if (active >= limit) {
      throw capacityError("concurrency_saturated", scope);
    }

    activeByScope.set(key, active + 1);
  }

  function leaveLocalConcurrency(key: string) {
    const active = activeByScope.get(key) ?? 0;

    if (active <= 1) {
      activeByScope.delete(key);
    } else {
      activeByScope.set(key, active - 1);
    }
  }

  function redisDegraded(phase: "acquire" | "release", error: unknown) {
    recordOperationalEvent("chatwoot_identity_guard_degraded", "redis");
    const currentTime = now();

    if (currentTime - lastRedisWarningAt < redisWarningIntervalMs) {
      return;
    }

    lastRedisWarningAt = currentTime;
    logger.warn("chatwoot_identity_guard_redis_unavailable", {
      phase,
      errorName: error instanceof Error ? error.name : "UnknownError",
    });
  }

  async function acquireDistributedLease({
    rateKey,
    concurrencyKey,
    rateLimit,
    concurrencyLimit,
    scope,
  }: {
    rateKey: string;
    concurrencyKey: string;
    rateLimit: number;
    concurrencyLimit: number;
    scope: ChatwootIdentityCapacityError["scope"];
  }): Promise<DistributedLease | null> {
    if (!distributedCommand) {
      return null;
    }

    const currentTime = now();
    const leaseToken = nextToken();
    let acquired: unknown;

    try {
      acquired = await distributedCommand([
        "EVAL",
        acquireLeaseScript,
        2,
        rateKey,
        concurrencyKey,
        limits().rateWindowMs,
        rateLimit,
        currentTime,
        currentTime + limits().leaseMs,
        leaseToken,
        concurrencyLimit,
        limits().leaseMs,
      ]);
    } catch (error) {
      // Support remains protected by the process-local bounds. Redis adds
      // cross-instance coordination but is not a new availability dependency.
      redisDegraded("acquire", error);
      return null;
    }

    if (acquired === -1) {
      throw capacityError("rate_limited", scope);
    }

    if (acquired === 0) {
      throw capacityError("concurrency_saturated", scope);
    }

    if (acquired !== 1) {
      redisDegraded(
        "acquire",
        new Error("Redis returned an invalid Chatwoot guard result"),
      );
      return null;
    }

    return { key: concurrencyKey, token: leaseToken };
  }

  async function releaseDistributedLease(lease: DistributedLease | null) {
    if (!lease || !distributedCommand) {
      return;
    }

    try {
      await distributedCommand(["ZREM", lease.key, lease.token]);
    } catch (error) {
      redisDegraded("release", error);
    }
  }

  async function runGuarded<T>({
    localKey,
    rateKey,
    rateLimit,
    concurrencyLimit,
    scope,
    work,
  }: {
    localKey: string;
    rateKey: string;
    rateLimit: number;
    concurrencyLimit: number;
    scope: ChatwootIdentityCapacityError["scope"];
    work: () => Promise<T>;
  }) {
    consumeLocalRate(`${localKey}:rate`, rateLimit, scope);
    enterLocalConcurrency(
      `${localKey}:concurrency`,
      concurrencyLimit,
      scope,
    );
    let lease: DistributedLease | null = null;

    try {
      lease = await acquireDistributedLease({
        rateKey,
        concurrencyKey: `${rateKey}:concurrency`,
        rateLimit,
        concurrencyLimit,
        scope,
      });
      return await work();
    } finally {
      await releaseDistributedLease(lease);
      leaveLocalConcurrency(`${localKey}:concurrency`);
    }
  }

  return {
    runAction<T>(work: () => Promise<T>) {
      const currentLimits = limits();

      return runGuarded({
        localKey: "global",
        rateKey: rateLimitCapacityKey(actionName),
        rateLimit: currentLimits.globalRateLimit,
        concurrencyLimit: currentLimits.globalConcurrencyLimit,
        scope: "global",
        work,
      });
    },

    async runProbe<T>({
      sessionId,
      conversationToken,
      work,
    }: {
      sessionId: string;
      conversationToken: string;
      work: () => Promise<T>;
    }) {
      const currentLimits = limits();
      const sessionRateKey = rateLimitKey({
        action: actionName,
        sessionId,
      });
      const localSessionKey = `session:${sha256(sessionId)}`;

      // Count every invocation even when its outbound request can join an
      // identical in-flight probe. Direct Server Action replay is therefore
      // bounded without multiplying Chatwoot traffic.
      consumeLocalRate(
        `${localSessionKey}:probe-invocations`,
        currentLimits.sessionRateLimit,
        "session",
      );

      const probeKey = `${localSessionKey}:${sha256(conversationToken)}`;
      const existing = inFlightProbes.get(probeKey) as Promise<T> | undefined;

      if (existing) {
        recordOperationalEvent("chatwoot_identity_probe_coalesced", "session");
        return existing;
      }

      const probe = runGuarded({
        localKey: localSessionKey,
        rateKey: sessionRateKey,
        rateLimit: currentLimits.sessionRateLimit,
        concurrencyLimit: currentLimits.sessionConcurrencyLimit,
        scope: "session",
        work,
      });
      inFlightProbes.set(probeKey, probe);

      try {
        return await probe;
      } finally {
        if (inFlightProbes.get(probeKey) === probe) {
          inFlightProbes.delete(probeKey);
        }
      }
    },
  };
}
