import { createHmac, randomUUID } from 'node:crypto';
import { headers } from 'next/headers';

import { redisCommand } from '@/backend/cache/redis';
import { getEnv } from '@/backend/config/env';
import { ServiceError } from '@/backend/errors/service-error';
import { getTrustedClientIp } from '@/backend/observability/audit';
import { logger } from '@/backend/observability/logger';
import { recordOperationalEvent } from '@/backend/observability/metrics';

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

// Anonymous preflight budget per trusted client address. The shared capacity
// bucket is global, so without this a single source could exhaust it before
// any human proof and lock every user out for the rest of the window.
export const AUTH_CLIENT_PREFLIGHT_LIMIT = 100;

function digest(kind: "email" | "tgid" | "session" | "client", value: string) {
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

export function rateLimitClientKey(action: string, clientIp: string) {
  const normalizedAction = normalizePart(action) ?? "unknown";
  return `clean-pay:rate-limit:v4:auth:${normalizedAction}:client:${digest("client", clientIp.trim().toLowerCase())}`;
}

async function currentTrustedClientIp() {
  try {
    return getTrustedClientIp(await headers(), getEnv().trustedProxyHops);
  } catch {
    // Outside a request scope (workers, scripts) there is no client address.
    return null;
  }
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
    throw new ServiceError('UPSTREAM_UNAVAILABLE', 503, 'Redis returned invalid rate-limit counters', {
      message: 'Invalid Redis INCR response',
    });
  }

  return count as number[];
}

async function assertSharedCapacity(
  capacityKey: string,
  action: string,
  windowSeconds: number,
) {
  let counts: number[];
  try {
    counts = await incrementRateLimits([capacityKey], windowSeconds);
  } catch (error) {
    logger.error("auth_rate_limit_unavailable", {
      action,
      errorName: error instanceof Error ? error.name : "UnknownError",
    });
    if (error instanceof ServiceError) throw error;
    throw new ServiceError("UPSTREAM_UNAVAILABLE", 503, "Authentication protection is temporarily unavailable", {
      retryAfterSeconds: Math.min(windowSeconds, 30),
    });
  }
  if ((counts[0] ?? 0) <= getEnv().authRateLimitCapacity) return;

  let retryAfterSeconds: number;
  try {
    retryAfterSeconds = await getRetryAfterSeconds(capacityKey, windowSeconds);
  } catch {
    retryAfterSeconds = Math.min(windowSeconds, 30);
  }
  recordOperationalEvent("rate_limit_capacity_rejected", action);
  throw new ServiceError(
    "RATE_LIMITED",
    429,
    "Too many attempts. Try again later.",
    { retryAfterSeconds },
  );
}

/**
 * Anonymous authentication guard: charges the proven target (or, without one,
 * the trusted client address) together with the action's shared capacity.
 * Authenticated per-user actions must use assertTargetRateLimit instead, so
 * legitimate load across many users is never capped globally.
 */
export async function assertRateLimit(options: RateLimitOptions) {
  const targetKey = rateLimitKey(options);
  const capacityKey = rateLimitCapacityKey(options.action);
  if (targetKey === capacityKey) {
    // Without a stable identity the per-target limit applies per client
    // address instead of silently degrading to the global capacity only.
    await assertRateLimitCapacity(
      options.action,
      options.windowSeconds,
      undefined,
      options.limit,
    );
    return;
  }
  const keys = [targetKey, capacityKey];
  let counts: number[];
  try {
    counts = await incrementRateLimits(keys, options.windowSeconds);
  } catch (error) {
    logger.error("auth_rate_limit_unavailable", {
      action: options.action,
      errorName: error instanceof Error ? error.name : "UnknownError",
    });
    if (error instanceof ServiceError) {
      throw error;
    }
    throw new ServiceError("UPSTREAM_UNAVAILABLE", 503, "Authentication protection is temporarily unavailable", {
      retryAfterSeconds: Math.min(options.windowSeconds, 30),
    });
  }
  const targetExceeded = (counts[0] ?? 0) > options.limit;
  const capacityLimit = getEnv().authRateLimitCapacity;
  const capacityExceeded = (counts.at(-1) ?? 0) > capacityLimit;

  if (targetExceeded || capacityExceeded) {
    const exceededKey = capacityExceeded ? capacityKey : targetKey;
    let retryAfterSeconds: number;
    try {
      retryAfterSeconds = await getRetryAfterSeconds(exceededKey, options.windowSeconds);
    } catch {
      retryAfterSeconds = Math.min(options.windowSeconds, 30);
    }

    recordOperationalEvent(
      capacityExceeded ? "rate_limit_capacity_rejected" : "rate_limit_target_rejected",
      options.action,
    );
    throw new ServiceError(
      'RATE_LIMITED',
      429,
      options.message ?? 'Too many attempts. Try again later.',
      { retryAfterSeconds },
    );
  }
}

/**
 * Consumes only the cheap shared capacity bucket. Call this before any
 * external proof/provider work and before a target identity is resolved.
 */
export async function assertRateLimitCapacity(
  action: string,
  windowSeconds = 15 * 60,
  clientIp?: string | null,
  clientLimit = AUTH_CLIENT_PREFLIGHT_LIMIT,
) {
  const resolvedClientIp = clientIp === undefined
    ? await currentTrustedClientIp()
    : clientIp;
  const capacityKey = rateLimitCapacityKey(action);
  if (!resolvedClientIp) {
    await assertSharedCapacity(capacityKey, action, windowSeconds);
    return;
  }

  const clientKey = rateLimitClientKey(action, resolvedClientIp);
  let counts: unknown;
  try {
    // A client over its own budget is rejected without consuming the shared
    // capacity, so one source cannot starve everybody else.
    counts = await redisCommand([
      "EVAL",
      "local client = redis.call('INCR', KEYS[1]); if client == 1 then redis.call('EXPIRE', KEYS[1], ARGV[1]); end; if client > tonumber(ARGV[2]) then return {client, 0} end; local capacity = redis.call('INCR', KEYS[2]); if capacity == 1 then redis.call('EXPIRE', KEYS[2], ARGV[1]); end; return {client, capacity}",
      2,
      clientKey,
      capacityKey,
      windowSeconds,
      clientLimit,
    ]);
  } catch (error) {
    logger.error("auth_rate_limit_unavailable", {
      action,
      errorName: error instanceof Error ? error.name : "UnknownError",
    });
    throw new ServiceError("UPSTREAM_UNAVAILABLE", 503, "Authentication protection is temporarily unavailable", {
      retryAfterSeconds: Math.min(windowSeconds, 30),
    });
  }

  if (
    !Array.isArray(counts) ||
    counts.length !== 2 ||
    counts.some((value) => typeof value !== "number")
  ) {
    throw new ServiceError('UPSTREAM_UNAVAILABLE', 503, 'Redis returned invalid rate-limit counters', {
      message: 'Invalid Redis INCR response',
    });
  }

  const [clientCount, capacityCount] = counts as [number, number];
  const clientExceeded = clientCount > clientLimit;
  const capacityExceeded = capacityCount > getEnv().authRateLimitCapacity;
  if (!clientExceeded && !capacityExceeded) return;

  const exceededKey = clientExceeded ? clientKey : capacityKey;
  let retryAfterSeconds: number;
  try {
    retryAfterSeconds = await getRetryAfterSeconds(exceededKey, windowSeconds);
  } catch {
    retryAfterSeconds = Math.min(windowSeconds, 30);
  }

  recordOperationalEvent(
    clientExceeded ? "rate_limit_client_rejected" : "rate_limit_capacity_rejected",
    action,
  );
  throw new ServiceError(
    'RATE_LIMITED',
    429,
    'Too many attempts. Try again later.',
    { retryAfterSeconds },
  );
}

/**
 * Consumes only the proven target bucket. The shared capacity bucket must
 * already have been consumed by assertRateLimitCapacity for this request.
 */
export async function assertTargetRateLimit(options: RateLimitOptions) {
  const targetKey = rateLimitKey(options);
  const capacityKey = rateLimitCapacityKey(options.action);

  if (targetKey === capacityKey) {
    throw new ServiceError(
      "VALIDATION_ERROR",
      400,
      "A stable authentication target is required for the target rate limit",
    );
  }

  let counts: number[];
  try {
    counts = await incrementRateLimits([targetKey], options.windowSeconds);
  } catch (error) {
    logger.error("auth_rate_limit_unavailable", {
      action: options.action,
      errorName: error instanceof Error ? error.name : "UnknownError",
    });
    if (error instanceof ServiceError) {
      throw error;
    }
    throw new ServiceError("UPSTREAM_UNAVAILABLE", 503, "Authentication protection is temporarily unavailable", {
      retryAfterSeconds: Math.min(options.windowSeconds, 30),
    });
  }

  if ((counts[0] ?? 0) <= options.limit) {
    return;
  }

  let retryAfterSeconds: number;
  try {
    retryAfterSeconds = await getRetryAfterSeconds(targetKey, options.windowSeconds);
  } catch {
    retryAfterSeconds = Math.min(options.windowSeconds, 30);
  }

  recordOperationalEvent("rate_limit_target_rejected", options.action);
  throw new ServiceError(
    "RATE_LIMITED",
    429,
    options.message ?? "Too many attempts. Try again later.",
    { retryAfterSeconds },
  );
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
    throw new ServiceError("UPSTREAM_UNAVAILABLE", 503, "Authentication protection is temporarily unavailable", {
      retryAfterSeconds: 2,
    });
  }

  if (acquired !== 1) {
    recordOperationalEvent("auth_concurrency_saturated", action);
    throw new ServiceError("UPSTREAM_UNAVAILABLE", 503, "Authentication capacity is temporarily exhausted", {
      retryAfterSeconds: 2,
    });
  }

  try {
    return await work();
  } finally {
    try {
      await redisCommand(["ZREM", key, token]);
    } catch (error) {
      recordOperationalEvent("auth_concurrency_release_failed", action);
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
  // A cooldown is strictly per key; it must not consume any shared budget.
  await assertTargetRateLimit({
    action,
    email: key,
    limit: 1,
    windowSeconds,
    message: 'Please wait before requesting another code.',
  });
}
