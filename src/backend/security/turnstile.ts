import { getEnv } from "@/backend/config/env";
import { logger } from "@/backend/observability/logger";
import { recordUpstreamRequest } from "@/backend/observability/metrics";
import {
  currentRequestTrace,
  tracedHeaders,
} from "@/backend/observability/request-trace";
import { ServiceError } from "@/backend/errors/service-error";
import {
  credentialedFetch,
  readBoundedJsonFromUnknown,
} from "@/backend/integrations/http/upstream-http";

type TurnstileResponse = {
  success: boolean;
  hostname?: string;
  action?: string;
  "error-codes"?: string[];
};

const maxTurnstileResponseBytes = 64 * 1024;

function decodeTurnstileResponse(value: unknown): TurnstileResponse {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError("Turnstile response must be an object");
  }

  const input = value as Record<string, unknown>;
  if (typeof input.success !== "boolean") {
    throw new TypeError("Turnstile response success must be a boolean");
  }
  if (input.hostname !== undefined && typeof input.hostname !== "string") {
    throw new TypeError("Turnstile response hostname must be a string");
  }
  if (input.action !== undefined && typeof input.action !== "string") {
    throw new TypeError("Turnstile response action must be a string");
  }
  if (
    input["error-codes"] !== undefined
    && (
      !Array.isArray(input["error-codes"])
      || !input["error-codes"].every((item) => typeof item === "string")
    )
  ) {
    throw new TypeError("Turnstile response error-codes must be strings");
  }

  return {
    success: input.success,
    ...(input.hostname === undefined ? {} : { hostname: input.hostname }),
    ...(input.action === undefined ? {} : { action: input.action }),
    ...(input["error-codes"] === undefined
      ? {}
      : { "error-codes": input["error-codes"] as string[] }),
  };
}

export async function verifyTurnstileToken(
  token: string | null | undefined,
  expectedAction: string,
) {
  const env = getEnv();

  if (!env.turnstile.enabled) {
    return;
  }

  if (!env.turnstile.secretKey) {
    throw new ServiceError("UPSTREAM_UNAVAILABLE", 503, "TURNSTILE_SECRET_KEY is required", {
      message: "TURNSTILE_SECRET_KEY is required",
    });
  }

  if (!token) {
    throw new ServiceError("FORBIDDEN", 403, "Turnstile token is required");
  }

  const body = new URLSearchParams({
    secret: env.turnstile.secretKey,
    response: token,
  });

  let response: Response | undefined;
  let outcome: "success" | "rejected" | "unavailable" = "unavailable";
  const startedAt = Date.now();
  const trace = await currentRequestTrace();

  logger.info("turnstile_request_sent", {
    method: "POST",
    hasToken: Boolean(token),
    action: expectedAction,
  }, {
    category: "upstream",
    source: "turnstile.client",
    message: "HTTP Request: POST Turnstile siteverify",
  });

  try {
    response = await credentialedFetch(env.turnstile.verifyUrl, {
      method: "POST",
      headers: tracedHeaders(undefined, trace),
      body,
      cache: "no-store",
      signal: AbortSignal.timeout(10_000),
    });
    let result: TurnstileResponse;
    try {
      result = decodeTurnstileResponse(
        await readBoundedJsonFromUnknown(response, {
          maxBytes: maxTurnstileResponseBytes,
        }),
      );
    } catch (error) {
      throw new ServiceError("UPSTREAM_UNAVAILABLE", 503, "Turnstile returned an invalid response", {
        upstreamStatus: response.status,
        upstreamPath: env.turnstile.verifyUrl,
        message: error instanceof Error ? error.message : String(error),
      });
    }
    logger.info("turnstile_response_received", {
      method: "POST",
      status: response.status,
      ok: response.ok,
      durationMs: Date.now() - startedAt,
      hasResponse: true,
    }, {
      category: "upstream",
      source: "turnstile.client",
      message: `HTTP Response: POST Turnstile siteverify -> ${response.status}`,
    });

    const expectedHostname = new URL(env.appUrl).hostname.toLowerCase();
    const responseHostname = result.hostname?.toLowerCase();
    const responseAction = result.action;
    const challengeAccepted = Boolean(
      result.success
      && responseHostname === expectedHostname
      && responseAction === expectedAction,
    );

    if (!response.ok) {
      throw new ServiceError("UPSTREAM_UNAVAILABLE", 503, "Turnstile verification unavailable", {
        upstreamStatus: response.status,
        upstreamPath: env.turnstile.verifyUrl,
      });
    }

    if (!challengeAccepted) {
      outcome = "rejected";
      throw new ServiceError("FORBIDDEN", 403, "Turnstile verification failed", {
        upstreamStatus: response.status,
        upstreamPath: env.turnstile.verifyUrl,
        upstreamDetail: {
          success: result.success,
          hostnameMatches: responseHostname === expectedHostname,
          actionMatches: responseAction === expectedAction,
          errorCodes: result["error-codes"],
        },
      });
    }

    outcome = "success";
  } catch (error) {
    if (response || error instanceof ServiceError) {
      throw error;
    }

    logger.error("turnstile_request_failed", {
      method: "POST",
      durationMs: Date.now() - startedAt,
      errorName: error instanceof Error ? error.name : "UnknownError",
    }, {
      category: "upstream",
      source: "turnstile.client",
      message: "HTTP Request failed: POST Turnstile siteverify",
    });
    throw new ServiceError("UPSTREAM_UNAVAILABLE", 503, "Turnstile verification unavailable", {
      message: error instanceof Error ? error.message : String(error),
    });
  } finally {
    recordUpstreamRequest({
      service: "turnstile",
      operation: "/turnstile/v0/siteverify",
      outcome,
      durationMs: Date.now() - startedAt,
    });
  }
}
