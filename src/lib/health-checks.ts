import net from "node:net";

import { logTechnicalWarning } from "@/lib/audit";
import { getEnv } from "@/lib/env";
import { prisma } from "@/lib/prisma";
import { redisCommand } from "@/lib/redis";

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

function smtpConnect(host: string, port: number) {
  return new Promise<void>((resolve, reject) => {
    const socket = net.connect({ host, port });
    const timeout = setTimeout(() => {
      socket.destroy();
      reject(new Error("SMTP connection timed out"));
    }, 3000);

    socket.once("connect", () => {
      clearTimeout(timeout);
      socket.end();
      resolve();
    });
    socket.once("error", (error) => {
      clearTimeout(timeout);
      reject(error);
    });
  });
}

export async function checkSmtp() {
  const env = getEnv();
  const result = await measure(async () => {
    await smtpConnect(env.smtp.host, env.smtp.port);
  });

  if (result.status === "down") {
    logTechnicalWarning("smtp_readiness_failed", {
      host: env.smtp.host,
      port: env.smtp.port,
      message: result.message,
    });
  }

  return result;
}

export function aggregateStatus(results: Record<string, CheckResult>) {
  return Object.values(results).every((result) => result.status === "ok") ? "ok" : "degraded";
}
