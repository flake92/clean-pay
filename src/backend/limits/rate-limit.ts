import { redisCommand } from '@/backend/cache/redis';
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
  const parts = [
    `action:${normalizePart(action) ?? 'unknown'}`,
    `email:${normalizePart(email) ?? 'none'}`,
    `tgid:${normalizePart(tgId) ?? 'none'}`,
  ];

  return `clean-pay:rate-limit:${parts.join(':')}`;
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
