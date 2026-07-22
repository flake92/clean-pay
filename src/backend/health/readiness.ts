import {
  aggregateStatus,
  checkDatabase,
  checkMailpit,
  checkRedis,
  checkRemnashop,
  checkRemnawave,
  checkTelegramOidc,
  type CheckResult,
} from "@/backend/health/checks";
import { redisCommand } from "@/backend/cache/redis";

export const READINESS_DEADLINE_MS = 8_000;
export const READINESS_STALE_AFTER_MS = 90_000;
const READINESS_CACHE_KEY = "clean-pay:health:readiness:v1";
const READINESS_CACHE_TTL_SECONDS = 120;

export type DetailedReadiness = {
  status: "ok" | "degraded";
  checkedAt: string;
  checks: Record<string, CheckResult>;
};

type ReadinessState = {
  cached: Pick<DetailedReadiness, "status" | "checkedAt"> | null;
  running: Promise<DetailedReadiness> | null;
};

const globalReadiness = globalThis as typeof globalThis & {
  cleanPayReadinessState?: ReadinessState;
};

function state() {
  globalReadiness.cleanPayReadinessState ??= { cached: null, running: null };
  return globalReadiness.cleanPayReadinessState;
}

async function performDetailedReadiness(): Promise<DetailedReadiness> {
  const deadlineSignal = AbortSignal.timeout(READINESS_DEADLINE_MS);
  const [database, redis, remnashop, telegramOidc, mailpit, remnawave] = await Promise.all([
    checkDatabase(deadlineSignal),
    checkRedis(deadlineSignal),
    checkRemnashop(deadlineSignal),
    checkTelegramOidc(deadlineSignal),
    checkMailpit(deadlineSignal),
    checkRemnawave(deadlineSignal),
  ]);
  const checks: Record<string, CheckResult> = { database, redis, remnashop, telegramOidc };

  if (mailpit) checks.mailpit = mailpit;
  if (remnawave) checks.remnawave = remnawave;

  const result: DetailedReadiness = {
    status: aggregateStatus(checks),
    checkedAt: new Date().toISOString(),
    checks,
  };
  state().cached = { status: result.status, checkedAt: result.checkedAt };

  try {
    await redisCommand([
      "SET",
      READINESS_CACHE_KEY,
      JSON.stringify(state().cached),
      "EX",
      READINESS_CACHE_TTL_SECONDS,
    ]);
  } catch {
    result.checks.redis = {
      status: "down",
      latencyMs: result.checks.redis?.latencyMs ?? 0,
      message: "Redis readiness cache is unavailable",
    };
    result.status = "degraded";
    state().cached = { status: result.status, checkedAt: result.checkedAt };
  }

  return result;
}

export function runDetailedReadiness() {
  const current = state();

  if (!current.running) {
    current.running = performDetailedReadiness().finally(() => {
      current.running = null;
    });
  }

  return current.running;
}

function parseCachedReadiness(value: unknown) {
  if (typeof value !== "string") return null;

  try {
    const parsed = JSON.parse(value) as Partial<Pick<DetailedReadiness, "status" | "checkedAt">>;

    if (
      (parsed.status === "ok" || parsed.status === "degraded")
      && typeof parsed.checkedAt === "string"
    ) {
      return { status: parsed.status, checkedAt: parsed.checkedAt };
    }
  } catch {
    // Invalid shared cache entries fail closed below.
  }

  return null;
}

export async function getPublicReadiness(now = Date.now()) {
  let cached: Pick<DetailedReadiness, "status" | "checkedAt"> | null = null;

  try {
    cached = parseCachedReadiness(await redisCommand(["GET", READINESS_CACHE_KEY]));
  } catch {
    // Public readiness must remain safe when Redis is unavailable.
  }

  cached ??= state().cached;
  const checkedAtMs = cached ? Date.parse(cached.checkedAt) : Number.NaN;
  const stale = !cached || !Number.isFinite(checkedAtMs) || now - checkedAtMs > READINESS_STALE_AFTER_MS;

  return {
    status: !stale && cached?.status === "ok" ? "ok" as const : "degraded" as const,
    checkedAt: cached?.checkedAt ?? null,
    stale,
  };
}

export function resetReadinessStateForTests() {
  delete globalReadiness.cleanPayReadinessState;
}
