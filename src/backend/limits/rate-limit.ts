import { createHmac } from 'node:crypto';

import { redisCommand } from '@/backend/cache/redis';
import { getEnv } from '@/backend/config/env';
import { BffError } from '@/backend/integrations/remnashop/errors';

type RateLimitIdentity = {
  action: string;
  email?: string | null;
  tgId?: string | number | bigint | null;
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

export function rateLimitKey({ action, email, tgId }: RateLimitIdentity) {
  const normalizedAction = normalizePart(action) ?? 'unknown';
  const digest = (kind: 'email' | 'tgid', value: string | null) => value === null
    ? 'none'
    : createHmac('sha256', getEnv().rateLimitIdentitySecret)
      .update(`clean-pay:rate-limit:v2:${kind}:${value}`)
      .digest('hex');
  const emailDigest = digest('email', normalizePart(email));
  const telegramDigest = digest('tgid', normalizePart(tgId));

  return `clean-pay:rate-limit:v2:${normalizedAction}:email:${emailDigest}:tgid:${telegramDigest}`;
}

async function getRetryAfterSeconds(key: string, windowSeconds: number) {
  const ttl = await redisCommand(['TTL', key]);

  return typeof ttl === 'number' && ttl > 0 ? ttl : windowSeconds;
}

async function incrementRateLimit(key: string, windowSeconds: number) {
  const count = await redisCommand([
    'EVAL',
    "local count = redis.call('INCR', KEYS[1]); if count == 1 then redis.call('EXPIRE', KEYS[1], ARGV[1]); end; return count",
    1,
    key,
    windowSeconds,
  ]);

  if (typeof count !== 'number') {
    throw new BffError('UPSTREAM_ERROR', 502, 'Redis returned invalid rate-limit counter', {
      message: 'Invalid Redis INCR response',
    });
  }

  return count;
}

export async function assertRateLimit(options: RateLimitOptions) {
  const key = rateLimitKey(options);
  const count = await incrementRateLimit(key, options.windowSeconds);

  if (count > options.limit) {
    const retryAfterSeconds = await getRetryAfterSeconds(key, options.windowSeconds);

    throw new BffError(
      'RATE_LIMITED',
      429,
      options.message ?? 'Too many attempts. Try again later.',
      { retryAfterSeconds },
    );
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
