import { getEnv } from "@/backend/config/env";
import { ServiceError } from "@/backend/errors/service-error";
import {
  cancelUpstreamResponseBody,
  credentialedFetch,
  readBoundedJsonFromUnknown,
} from "@/backend/integrations/http/upstream-http";
import { logger } from "@/backend/observability/logger";
import {
  recordUpstreamRequest,
  upstreamOperation,
} from "@/backend/observability/metrics";
import {
  currentRequestTrace,
  tracedHeaders,
} from "@/backend/observability/request-trace";

const maxRemnawaveResponseBytes = 1024 * 1024;

function remnawaveEndpoint(path: string) {
  const baseUrl = getEnv().remnawave.apiBaseUrl?.replace(/\/$/, "");

  if (!baseUrl) {
    return null;
  }

  return `${baseUrl}/api${path}`;
}

function authorizationHeader(token: string) {
  return token.startsWith("Bearer ") ? token : `Bearer ${token}`;
}

export async function requestRemnawave<T>(
  path: string,
  decode: (value: unknown) => T,
) {
  const endpoint = remnawaveEndpoint(path);
  const token = getEnv().remnawave.token;
  const operation = upstreamOperation(path);

  if (!endpoint || !token) {
    logger.warn("remnawave_live_subscription_skipped", {
      path: operation,
      hasEndpoint: Boolean(endpoint),
      hasToken: Boolean(token),
    }, {
      category: "upstream",
      source: "remnawave.client",
      message: "Skipped live Remnawave subscription lookup",
    });
    return null;
  }

  const startedAt = Date.now();
  const trace = await currentRequestTrace();
  let outcome: "success" | "rejected" | "unavailable" = "unavailable";

  try {
    const response = await credentialedFetch(endpoint, {
      headers: tracedHeaders({
        accept: "application/json",
        authorization: authorizationHeader(token),
      }, trace),
      cache: "no-store",
      signal: AbortSignal.timeout(10_000),
    });

    if (response.status === 404) {
      outcome = "rejected";
      await cancelUpstreamResponseBody(response);
      return null;
    }

    if (!response.ok) {
      outcome = "rejected";
      await cancelUpstreamResponseBody(response);
      logger.warn("remnawave_live_subscription_failed", {
        path: operation,
        status: response.status,
      }, {
        category: "upstream",
        source: "remnawave.client",
        message: `Remnawave lookup failed: GET ${operation} -> ${response.status}`,
      });
      return null;
    }

    const result = decode(
      await readBoundedJsonFromUnknown(response, {
        maxBytes: maxRemnawaveResponseBytes,
      }),
    );
    outcome = "success";
    return result;
  } catch (error) {
    logger.warn("remnawave_live_subscription_unavailable", {
      path: operation,
      errorName: error instanceof Error ? error.name : "UnknownError",
    }, {
      category: "upstream",
      source: "remnawave.client",
      message: `Remnawave lookup unavailable: GET ${operation}`,
    });
    return null;
  } finally {
    recordUpstreamRequest({
      service: "remnawave",
      operation,
      outcome,
      durationMs: Date.now() - startedAt,
    });
  }
}

export function remnawaveIdentitySynchronizationTarget() {
  const endpoint = remnawaveEndpoint("/users");
  const token = getEnv().remnawave.token;
  if (!endpoint || !token) {
    throw new ServiceError(
      "UPSTREAM_UNAVAILABLE",
      503,
      "Remnawave identity synchronization is not configured.",
    );
  }

  return { endpoint, token };
}

type RemnawaveIdentityPatchInput = {
  uuid: string;
  email: string;
  telegramId: string;
};

export type RemnawaveIdentityPatchOutcome =
  | { kind: "success" }
  | { kind: "rejected"; status: number }
  | { kind: "unavailable"; errorName: string };

export async function patchRemnawaveUserIdentity(
  target: { endpoint: string; token: string },
  input: RemnawaveIdentityPatchInput,
): Promise<RemnawaveIdentityPatchOutcome> {
  let outcome: "success" | "rejected" | "unavailable" = "unavailable";
  const startedAt = Date.now();
  const trace = await currentRequestTrace();

  try {
    const response = await credentialedFetch(target.endpoint, {
      method: "PATCH",
      headers: tracedHeaders({
        accept: "application/json",
        authorization: authorizationHeader(target.token),
        "content-type": "application/json",
      }, trace),
      body: JSON.stringify({
        uuid: input.uuid,
        email: input.email,
        telegramId: Number(input.telegramId),
      }),
      cache: "no-store",
      signal: AbortSignal.timeout(10_000),
    });

    await cancelUpstreamResponseBody(response);
    if (!response.ok) {
      outcome = "rejected";
      return { kind: "rejected", status: response.status };
    }

    outcome = "success";
    return { kind: "success" };
  } catch (error) {
    return {
      kind: "unavailable",
      errorName: error instanceof Error ? error.name : "UnknownError",
    };
  } finally {
    recordUpstreamRequest({
      service: "remnawave",
      operation: "/users",
      outcome,
      durationMs: Date.now() - startedAt,
    });
  }
}
