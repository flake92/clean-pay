import {
  aggregateReadinessStatus,
  measureReadinessCheck,
  type CheckResult,
} from "@/application/health/readiness";
import type { ReadinessGateway } from "@/application/health/ports/readiness-gateway";
import { redisCommand } from "@/backend/cache/redis";
import { getEnv } from "@/backend/config/env";
import { prismaDatabaseHealthCheck } from "@/backend/integrations/health/prisma-database-health-check";

const READINESS_CACHE_KEY = "clean-pay:health:readiness:v1";

export function createProductionReadinessGateway(): ReadinessGateway {
  const env = getEnv();
  const mailpitUrl = env.readiness.mailpitUrl;
  const remnawaveUrl = env.readiness.remnawaveUrl;
  const remnawaveToken = env.remnawave.token;

  return {
    async checkDatabase() {
      await prismaDatabaseHealthCheck.ping();
    },
    async checkRedis() {
      const pong = await redisCommand(["PING"]);
      if (pong !== "PONG") throw new Error("Redis did not return PONG");
    },
    async checkRemnashop(signal) {
      const plansResponse = await fetch(`${env.remnashopApiBaseUrl}/plans/public`, {
        cache: "no-store",
        signal,
      });

      if (plansResponse.status === 404) {
        throw new Error("Remnashop public API returned 404; enable WEB_ENABLED=true with APP_API_KEY and APP_JWT_SECRET in Remnashop");
      }
      if (!plansResponse.ok) throw new Error(`Remnashop returned ${plansResponse.status}`);
      if (!env.remnashopAuthServiceKey) {
        throw new Error("REMNASHOP_AUTH_SERVICE_KEY is not configured");
      }

      for (const path of ["/auth/email/start", "/auth/identify", "/auth/service-session"]) {
        const response = await fetch(`${env.remnashopApiBaseUrl}${path}`, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-remnashop-auth-service-key": env.remnashopAuthServiceKey,
          },
          body: "{}",
          cache: "no-store",
          signal,
        });

        if (response.status === 404) throw new Error(`Remnashop is incompatible: ${path} is missing`);
        if (response.status === 401 || response.status === 403) {
          throw new Error("Remnashop rejected REMNASHOP_AUTH_SERVICE_KEY");
        }
        if (response.status !== 422) {
          throw new Error(`Remnashop ${path} contract returned ${response.status}, expected 422`);
        }
      }
    },
    async checkTelegramOidc(signal) {
      const response = await fetch(env.telegramOidc.jwksUri, {
        cache: "no-store",
        signal,
      });

      if (!response.ok) throw new Error(`Telegram OIDC returned ${response.status}`);
      const body = await response.json() as { keys?: unknown[] };
      if (!Array.isArray(body.keys) || body.keys.length === 0) {
        throw new Error("Telegram OIDC JWKS did not include keys");
      }
    },
    ...(mailpitUrl ? {
      async checkMailpit(signal: AbortSignal) {
        const response = await fetch(new URL("/api/v1/messages", mailpitUrl), {
          cache: "no-store",
          signal,
        });
        if (!response.ok) throw new Error(`Mailpit returned ${response.status}`);
      },
    } : {}),
    ...(remnawaveUrl ? {
      async checkRemnawave(signal: AbortSignal) {
        if (!remnawaveToken) throw new Error("Remnawave token is not configured");
        const response = await fetch(new URL("/api/system/metadata", remnawaveUrl), {
          headers: {
            accept: "application/json",
            authorization: remnawaveToken.startsWith("Bearer ")
              ? remnawaveToken
              : `Bearer ${remnawaveToken}`,
          },
          cache: "no-store",
          signal,
        });
        if (!response.ok) throw new Error(`Remnawave returned ${response.status}`);
      },
    } : {}),
    readSharedState() {
      return redisCommand(["GET", READINESS_CACHE_KEY]);
    },
    async writeSharedState(value, ttlSeconds) {
      await redisCommand(["SET", READINESS_CACHE_KEY, value, "EX", ttlSeconds]);
    },
  };
}

export function checkDatabase(deadlineSignal?: AbortSignal) {
  const gateway = createProductionReadinessGateway();
  return measureReadinessCheck("Database", gateway.checkDatabase, deadlineSignal);
}

export function checkRedis(deadlineSignal?: AbortSignal) {
  const gateway = createProductionReadinessGateway();
  return measureReadinessCheck("Redis", gateway.checkRedis, deadlineSignal);
}

export function checkRemnashop(deadlineSignal?: AbortSignal) {
  const gateway = createProductionReadinessGateway();
  return measureReadinessCheck("Remnashop", gateway.checkRemnashop, deadlineSignal);
}

export function checkMailpit(deadlineSignal?: AbortSignal) {
  const check = createProductionReadinessGateway().checkMailpit;
  return check ? measureReadinessCheck("Mailpit", check, deadlineSignal) : Promise.resolve(null);
}

export function checkTelegramOidc(deadlineSignal?: AbortSignal) {
  const gateway = createProductionReadinessGateway();
  return measureReadinessCheck("Telegram OIDC", gateway.checkTelegramOidc, deadlineSignal);
}

export function checkRemnawave(deadlineSignal?: AbortSignal) {
  const check = createProductionReadinessGateway().checkRemnawave;
  return check ? measureReadinessCheck("Remnawave", check, deadlineSignal) : Promise.resolve(null);
}

export function aggregateStatus(results: Record<string, CheckResult>) {
  return aggregateReadinessStatus(results);
}
