import { getEnv } from "@/backend/config/env";
import { readinessPrisma } from "@/backend/database/readiness-prisma";
import { redisCommand } from "@/backend/cache/redis";

export type CheckResult = {
  status: "ok" | "down";
  latencyMs: number;
  message?: string;
};

const readinessCheckTimeoutMs = 5_000;

async function measure(
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

    return {
      status: "down",
      latencyMs: Date.now() - startedAt,
      message,
    };
  }
}

export async function checkDatabase(deadlineSignal?: AbortSignal) {
  return measure("Database", async () => {
    await readinessPrisma.$queryRaw`SELECT 1`;
  }, deadlineSignal);
}

export async function checkRedis(deadlineSignal?: AbortSignal) {
  return measure("Redis", async () => {
    const pong = await redisCommand(["PING"]);

    if (pong !== "PONG") {
      throw new Error("Redis did not return PONG");
    }
  }, deadlineSignal);
}

export async function checkRemnashop(deadlineSignal?: AbortSignal) {
  const env = getEnv();

  return measure("Remnashop", async (signal) => {
    const response = await fetch(`${env.remnashopApiBaseUrl}/plans/public`, {
      cache: "no-store",
      signal,
    });

    if (response.status === 404) {
      throw new Error("Remnashop public API returned 404; enable WEB_ENABLED=true with APP_API_KEY and APP_JWT_SECRET in Remnashop");
    }

    if (!response.ok) {
      throw new Error(`Remnashop returned ${response.status}`);
    }
  }, deadlineSignal);
}

export async function checkMailpit(deadlineSignal?: AbortSignal) {
  const env = getEnv();
  const mailpitUrl = env.readiness.mailpitUrl;

  if (!mailpitUrl) {
    return null;
  }

  return measure("Mailpit", async (signal) => {
    const response = await fetch(new URL("/api/v1/messages", mailpitUrl), {
      cache: "no-store",
      signal,
    });

    if (!response.ok) {
      throw new Error(`Mailpit returned ${response.status}`);
    }
  }, deadlineSignal);
}

export async function checkTelegramOidc(deadlineSignal?: AbortSignal) {
  const env = getEnv();

  return measure("Telegram OIDC", async (signal) => {
    const response = await fetch(env.telegramOidc.jwksUri, {
      cache: "no-store",
      signal,
    });

    if (!response.ok) {
      throw new Error(`Telegram OIDC returned ${response.status}`);
    }

    const body = await response.json() as { keys?: unknown[] };

    if (!Array.isArray(body.keys) || body.keys.length === 0) {
      throw new Error("Telegram OIDC JWKS did not include keys");
    }
  }, deadlineSignal);
}

export async function checkRemnawave(deadlineSignal?: AbortSignal) {
  const env = getEnv();
  const remnawaveUrl = env.readiness.remnawaveUrl;
  const token = env.remnawave.token;

  if (!remnawaveUrl) {
    return null;
  }

  return measure("Remnawave", async (signal) => {
    if (!token) {
      throw new Error("Remnawave token is not configured");
    }

    const response = await fetch(new URL("/api/system/metadata", remnawaveUrl), {
      headers: {
        accept: "application/json",
        authorization: token.startsWith("Bearer ") ? token : `Bearer ${token}`,
      },
      cache: "no-store",
      signal,
    });

    if (!response.ok) {
      throw new Error(`Remnawave returned ${response.status}`);
    }
  }, deadlineSignal);
}

export function aggregateStatus(results: Record<string, CheckResult>) {
  return Object.values(results).every((result) => result.status === "ok") ? "ok" : "degraded";
}
