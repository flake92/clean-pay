import { createHmac, randomUUID } from 'node:crypto';

import { redisCommand } from '@/backend/cache/redis';
import { getEnv } from '@/backend/config/env';
import { BffError } from '@/backend/integrations/remnashop/errors';
import { logger } from '@/backend/observability/logger';

type RateLimitIdentity = {
  action: string;
  email?: string | null;
  tgId?: string | number | bigint | null;
  sessionId?: string | null;
};

type RateLimitOptions = RateLimitIdentity & {
  limit: number;
  windowSeconds: number;
  message?: string;
};

function normalizePart(value: string | number | bigint | null | undefined) {
  if (value === null || value === undefined || value === '') {
    return null;
  }

  return String(value).trim().toLowerCase();
}

function digest(kind: "email" | "tgid" | "session", value: string) {
  return createHmac("sha256", getEnv().rateLimitIdentitySecret)
    .update(`clean-pay:rate-limit:v4:${kind}:${value}`)
    .digest("hex");
}

export function rateLimitKey({ action, email, tgId, sessionId }: RateLimitIdentity) {
  const normalizedAction = normalizePart(action) ?? 'unknown';
  const target = normalizePart(email)
    ? ["email", normalizePart(email)!] as const
    : normalizePart(tgId)
      ? ["tgid", normalizePart(tgId)!] as const
      : normalizePart(sessionId)
        ? ["session", normalizePart(sessionId)!] as const
        : null;

  return target
    ? `clean-pay:rate-limit:v4:auth:${normalizedAction}:${target[0]}:${digest(target[0], target[1])}`
    : `clean-pay:rate-limit:v4:auth:${normalizedAction}:capacity`;
}

export function rateLimitCapacityKey(action: string) {
  const normalizedAction = normalizePart(action) ?? "unknown";
  return `clean-pay:rate-limit:v4:auth:${normalizedAction}:capacity`;
}

function concurrencyKey(action: string) {
  const normalizedAction = normalizePart(action) ?? "unknown";
  return `clean-pay:concurrency:v1:auth:${normalizedAction}`;
}

async function getRetryAfterSeconds(key: string, windowSeconds: number) {
  const ttl = await redisCommand(['TTL', key]);

  return typeof ttl === 'number' && ttl > 0 ? ttl : windowSeconds;
}

async function incrementRateLimits(keys: string[], windowSeconds: number) {
  const count = await redisCommand([
    'EVAL',
    "local counts = {}; for i, key in ipairs(KEYS) do local count = redis.call('INCR', key); if count == 1 then redis.call('EXPIRE', key, ARGV[1]); end; counts[i] = count; end; return counts",
    keys.length,
    ...keys,
    windowSeconds,
  ]);

  if (
    !Array.isArray(count) ||
    count.length !== keys.length ||
    count.some((value) => typeof value !== "number")
  ) {
    throw new BffError('UPSTREAM_UNAVAILABLE', 503, 'Redis returned invalid rate-limit counters', {
      message: 'Invalid Redis INCR response',
    });
  }

  return count as number[];
}

export async function assertRateLimit(options: RateLimitOptions) {
  const targetKey = rateLimitKey(options);
  const capacityKey = rateLimitCapacityKey(options.action);
  const keys = targetKey === capacityKey ? [capacityKey] : [targetKey, capacityKey];
  let counts: number[];
  try {
    counts = await incrementRateLimits(keys, options.windowSeconds);
  } catch (error) {
    logger.error("auth_rate_limit_unavailable", {
      action: options.action,
      errorName: error instanceof Error ? error.name : "UnknownError",
    });
    if (error instanceof BffError) {
      throw error;
    }
    throw new BffError("UPSTREAM_UNAVAILABLE", 503, "Authentication protection is temporarily unavailable", {
      retryAfterSeconds: Math.min(options.windowSeconds, 30),
    });
  }
  const targetExceeded = keys.length === 2 && (counts[0] ?? 0) > options.limit;
  const capacityLimit = keys.length === 1
    ? Math.min(options.limit, getEnv().authRateLimitCapacity)
    : getEnv().authRateLimitCapacity;
  const capacityExceeded = (counts.at(-1) ?? 0) > capacityLimit;

  if (targetExceeded || capacityExceeded) {
    const exceededKey = capacityExceeded ? capacityKey : targetKey;
    let retryAfterSeconds: number;
    try {
      retryAfterSeconds = await getRetryAfterSeconds(exceededKey, options.windowSeconds);
    } catch {
      retryAfterSeconds = Math.min(options.windowSeconds, 30);
    }

    throw new BffError(
      'RATE_LIMITED',
      429,
      options.message ?? 'Too many attempts. Try again later.',
      { retryAfterSeconds },
    );
  }
}

export async function withAuthConcurrency<T>(
  action: string,
  work: () => Promise<T>,
  ttlMs = 30_000,
): Promise<T> {
  const key = concurrencyKey(action);
  const token = randomUUID();
  const now = Date.now();
  let acquired: unknown;

  try {
    acquired = await redisCommand([
      "EVAL",
      "redis.call('ZREMRANGEBYSCORE', KEYS[1], '-inf', ARGV[1]); if redis.call('ZCARD', KEYS[1]) >= tonumber(ARGV[4]) then return 0 end; redis.call('ZADD', KEYS[1], ARGV[2], ARGV[3]); redis.call('PEXPIRE', KEYS[1], ARGV[5]); return 1",
      1,
      key,
      now,
      now + ttlMs,
      token,
      getEnv().authConcurrencyLimit,
      ttlMs,
    ]);
  } catch (error) {
    logger.error("auth_concurrency_unavailable", {
      action,
      errorName: error instanceof Error ? error.name : "UnknownError",
    });
    throw new BffError("UPSTREAM_UNAVAILABLE", 503, "Authentication protection is temporarily unavailable", {
      retryAfterSeconds: 2,
    });
  }

  if (acquired !== 1) {
    throw new BffError("UPSTREAM_UNAVAILABLE", 503, "Authentication capacity is temporarily exhausted", {
      retryAfterSeconds: 2,
    });
  }

  try {
    return await work();
  } finally {
    try {
      await redisCommand(["ZREM", key, token]);
    } catch (error) {
      logger.error("auth_concurrency_release_failed", {
        action,
        errorName: error instanceof Error ? error.name : "UnknownError",
      });
    }
  }
}

export async function assertCooldown({
  key,
  action,
  windowSeconds,
}: {
  key: string;
  action: string;
  windowSeconds: number;
}) {
  await assertRateLimit({
    action,
    email: key,
    limit: 1,
    windowSeconds,
    message: 'Please wait before requesting another code.',
  });
}

export async function recordRateLimitEvent() {
  // Redis counters are recorded by assertRateLimit(). Kept for compatibility with old callers.
}
