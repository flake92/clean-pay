import type { ReadinessGateway } from "@/application/health/ports/readiness-gateway";

export const READINESS_DEADLINE_MS = 8_000;
export const READINESS_STALE_AFTER_MS = 90_000;
export const READINESS_CACHE_TTL_SECONDS = 120;
const readinessCheckTimeoutMs = 5_000;

export type CheckResult = {
  status: "ok" | "down";
  latencyMs: number;
  message?: string;
};

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

export async function measureReadinessCheck(
  label: string,
  check: (signal: AbortSignal) => Promise<void>,
  deadlineSignal?: AbortSignal,
): Promise<CheckResult> {
  const startedAt = Date.now();
  const timeoutSignal = AbortSignal.timeout(readinessCheckTimeoutMs);
  const signal = deadlineSignal
    ? AbortSignal.any([deadlineSignal, timeoutSignal])
    : timeoutSignal;

  try {
    await Promise.race([
      check(signal),
      new Promise<never>((_, reject) => {
        if (signal.aborted) {
          reject(signal.reason);
          return;
        }

        signal.addEventListener("abort", () => reject(signal.reason), { once: true });
      }),
    ]);

    return { status: "ok", latencyMs: Date.now() - startedAt };
  } catch (error) {
    const message = deadlineSignal?.aborted
      ? `${label} cancelled: readiness deadline exceeded`
      : timeoutSignal.aborted
        ? `${label} timed out after ${readinessCheckTimeoutMs}ms`
        : error instanceof Error ? error.message : String(error);

    return { status: "down", latencyMs: Date.now() - startedAt, message };
  }
}

export function aggregateReadinessStatus(results: Record<string, CheckResult>) {
  return Object.values(results).every((result) => result.status === "ok")
    ? "ok" as const
    : "degraded" as const;
}

async function performDetailedReadiness(gateway: ReadinessGateway): Promise<DetailedReadiness> {
  const deadlineSignal = AbortSignal.timeout(READINESS_DEADLINE_MS);
  const entries: Array<Promise<readonly [string, CheckResult]>> = [
    measureReadinessCheck("Database", gateway.checkDatabase, deadlineSignal).then((result) => ["database", result]),
    measureReadinessCheck("Redis", gateway.checkRedis, deadlineSignal).then((result) => ["redis", result]),
    measureReadinessCheck("Remnashop", gateway.checkRemnashop, deadlineSignal).then((result) => ["remnashop", result]),
    measureReadinessCheck("Telegram OIDC", gateway.checkTelegramOidc, deadlineSignal).then((result) => ["telegramOidc", result]),
  ];

  if (gateway.checkMailpit) {
    entries.push(measureReadinessCheck("Mailpit", gateway.checkMailpit, deadlineSignal).then((result) => ["mailpit", result]));
  }
  if (gateway.checkRemnawave) {
    entries.push(measureReadinessCheck("Remnawave", gateway.checkRemnawave, deadlineSignal).then((result) => ["remnawave", result]));
  }

  const checks = Object.fromEntries(await Promise.all(entries));
  const result: DetailedReadiness = {
    status: aggregateReadinessStatus(checks),
    checkedAt: new Date().toISOString(),
    checks,
  };
  state().cached = { status: result.status, checkedAt: result.checkedAt };

  try {
    await gateway.writeSharedState(JSON.stringify(state().cached), READINESS_CACHE_TTL_SECONDS);
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

export function runDetailedReadiness(gateway: ReadinessGateway) {
  const current = state();

  if (!current.running) {
    current.running = performDetailedReadiness(gateway).finally(() => {
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

export async function getPublicReadiness(
  gateway: Pick<ReadinessGateway, "readSharedState">,
  now = Date.now(),
) {
  let cached: Pick<DetailedReadiness, "status" | "checkedAt"> | null = null;

  try {
    cached = parseCachedReadiness(await gateway.readSharedState());
  } catch {
    // Public readiness must remain safe when the shared cache is unavailable.
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
