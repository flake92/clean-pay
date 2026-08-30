import type { ReadinessGateway } from "@/application/health/ports/readiness-gateway";
import { redisCommand } from "@/backend/cache/redis";
import { getEnv } from "@/backend/config/env";
import { prismaDatabaseHealthCheck } from "@/backend/integrations/health/prisma-database-health-check";
import {
  credentialedFetch,
  readBoundedJsonFromUnknown,
} from "@/backend/integrations/http/upstream-http";

const READINESS_CACHE_KEY = "clean-pay:health:readiness:v1";
const MAX_READINESS_JSON_BYTES = 1024 * 1024;

async function cancelResponseBody(response: Response) {
  try {
    await response.body?.cancel();
  } catch {
    // The body may already be consumed or aborted by the readiness deadline.
  }
}

export function createProductionReadinessGateway(): ReadinessGateway {
  const env = getEnv();
  const mailpitUrl = env.readiness.mailpitUrl;
  const remnawaveUrl = env.readiness.remnawaveUrl;
  const telegramOidcJwksUrl = env.readiness.telegramOidcJwksUrl
    ?? env.telegramOidc.jwksUri;
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
      const plansResponse = await credentialedFetch(`${env.remnashopApiBaseUrl}/plans/public`, {
        cache: "no-store",
        signal,
      });

      try {
        if (plansResponse.status === 404) {
          throw new Error("Remnashop public API returned 404; enable WEB_ENABLED=true with APP_API_KEY and APP_JWT_SECRET in Remnashop");
        }
        if (!plansResponse.ok) throw new Error(`Remnashop returned ${plansResponse.status}`);
      } finally {
        await cancelResponseBody(plansResponse);
      }
      if (!env.remnashopAuthServiceKey) {
        throw new Error("REMNASHOP_AUTH_SERVICE_KEY is not configured");
      }

      for (const path of ["/auth/email/start", "/auth/identify", "/auth/service-session"]) {
        const response = await credentialedFetch(`${env.remnashopApiBaseUrl}${path}`, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-remnashop-auth-service-key": env.remnashopAuthServiceKey,
          },
          body: "{}",
          cache: "no-store",
          signal,
        });

        try {
          if (response.status === 404) throw new Error(`Remnashop is incompatible: ${path} is missing`);
          if (response.status === 401 || response.status === 403) {
            throw new Error("Remnashop rejected REMNASHOP_AUTH_SERVICE_KEY");
          }
          if (response.status !== 422) {
            throw new Error(`Remnashop ${path} contract returned ${response.status}, expected 422`);
          }
        } finally {
          await cancelResponseBody(response);
        }
      }

      // No user cookie is available to readiness. An unsupported method checks
      // the exact path without changing state: FastAPI returns 405 when the
      // PR #135 route exists and 404 on an older Remnashop image.
      const notificationPreferencesResponse = await credentialedFetch(
        `${env.remnashopApiBaseUrl}/auth/notification-preferences`,
        {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-remnashop-auth-service-key": env.remnashopAuthServiceKey,
          },
          body: "{}",
          cache: "no-store",
          signal,
        },
      );
      try {
        if (notificationPreferencesResponse.status === 404) {
          throw new Error("Remnashop is incompatible: /auth/notification-preferences is missing");
        }
        if (notificationPreferencesResponse.status !== 405) {
          throw new Error(
            "Remnashop /auth/notification-preferences contract returned "
            + `${notificationPreferencesResponse.status}, expected 405`,
          );
        }
      } finally {
        await cancelResponseBody(notificationPreferencesResponse);
      }
    },
    async checkTelegramOidc(signal) {
      const response = await credentialedFetch(telegramOidcJwksUrl, {
        cache: "no-store",
        signal,
      });

      if (!response.ok) {
        await cancelResponseBody(response);
        throw new Error(`Telegram OIDC returned ${response.status}`);
      }
      const value = await readBoundedJsonFromUnknown(response, {
        maxBytes: MAX_READINESS_JSON_BYTES,
      });
      const keys = value && typeof value === "object" && !Array.isArray(value)
        ? (value as Record<string, unknown>).keys
        : undefined;
      if (!Array.isArray(keys) || keys.length === 0) {
        throw new Error("Telegram OIDC JWKS did not include keys");
      }
    },
    ...(mailpitUrl ? {
      async checkMailpit(signal: AbortSignal) {
        const response = await fetch(new URL("/api/v1/messages", mailpitUrl), {
          cache: "no-store",
          signal,
        });
        try {
          if (!response.ok) throw new Error(`Mailpit returned ${response.status}`);
        } finally {
          await cancelResponseBody(response);
        }
      },
    } : {}),
    ...(remnawaveUrl ? {
      async checkRemnawave(signal: AbortSignal) {
        if (!remnawaveToken) throw new Error("Remnawave token is not configured");
        const response = await credentialedFetch(new URL("/api/system/metadata", remnawaveUrl), {
          headers: {
            accept: "application/json",
            authorization: remnawaveToken.startsWith("Bearer ")
              ? remnawaveToken
              : `Bearer ${remnawaveToken}`,
          },
          cache: "no-store",
          signal,
        });
        try {
          if (!response.ok) throw new Error(`Remnawave returned ${response.status}`);
        } finally {
          await cancelResponseBody(response);
        }
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
