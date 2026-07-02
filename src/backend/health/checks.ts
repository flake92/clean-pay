import { getEnv } from "@/backend/config/env";
import { prisma } from "@/backend/database/prisma";
import { redisCommand } from "@/backend/cache/redis";

type CheckResult = {
  status: "ok" | "down";
  latencyMs: number;
  message?: string;
};

async function measure(check: () => Promise<void>): Promise<CheckResult> {
  const startedAt = Date.now();

  try {
    await check();

    return { status: "ok", latencyMs: Date.now() - startedAt };
  } catch (error) {
    return {
      status: "down",
      latencyMs: Date.now() - startedAt,
      message: error instanceof Error ? error.message : String(error),
    };
  }
}

export async function checkDatabase() {
  return measure(async () => {
    await prisma.$queryRaw`SELECT 1`;
  });
}

export async function checkRedis() {
  return measure(async () => {
    const pong = await redisCommand(["PING"]);

    if (pong !== "PONG") {
      throw new Error("Redis did not return PONG");
    }
  });
}

export async function checkRemnashop() {
  const env = getEnv();

  return measure(async () => {
    const response = await fetch(`${env.remnashopApiBaseUrl}/plans/public`, {
      cache: "no-store",
    });

    if (!response.ok) {
      throw new Error(`Remnashop returned ${response.status}`);
    }
  });
}

export async function checkMailpit() {
  const env = getEnv();
  const mailpitUrl = env.readiness.mailpitUrl;

  if (!mailpitUrl) {
    return null;
  }

  return measure(async () => {
    const response = await fetch(new URL("/api/v1/messages", mailpitUrl), {
      cache: "no-store",
    });

    if (!response.ok) {
      throw new Error(`Mailpit returned ${response.status}`);
    }
  });
}

export async function checkTelegramOidc() {
  const env = getEnv();

  return measure(async () => {
    const response = await fetch(env.telegramOidc.jwksUri, {
      cache: "no-store",
    });

    if (!response.ok) {
      throw new Error(`Telegram OIDC returned ${response.status}`);
    }

    const body = await response.json() as { keys?: unknown[] };

    if (!Array.isArray(body.keys) || body.keys.length === 0) {
      throw new Error("Telegram OIDC JWKS did not include keys");
    }
  });
}

export async function checkRemnawave() {
  const env = getEnv();
  const remnawaveUrl = env.readiness.remnawaveUrl;

  if (!remnawaveUrl) {
    return null;
  }

  return measure(async () => {
    const response = await fetch(new URL("/api/system/metadata", remnawaveUrl), {
      cache: "no-store",
    });

    if (!response.ok) {
      throw new Error(`Remnawave returned ${response.status}`);
    }
  });
}

export function aggregateStatus(results: Record<string, CheckResult>) {
  return Object.values(results).every((result) => result.status === "ok") ? "ok" : "degraded";
}
