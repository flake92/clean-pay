import { getEnv } from "@/backend/config/env";
import { logger } from "@/backend/observability/logger";
import { recordUpstreamRequest } from "@/backend/observability/metrics";
import {
  currentRequestTrace,
  tracedHeaders,
} from "@/backend/observability/request-trace";
import { ServiceError } from "@/backend/errors/service-error";

type TurnstileResponse = {
  success?: boolean;
  hostname?: string;
  action?: string;
  "error-codes"?: string[];
};

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

  let response: Response;
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
    response = await fetch(env.turnstile.verifyUrl, {
      method: "POST",
      headers: tracedHeaders(undefined, trace),
      body,
      cache: "no-store",
      signal: AbortSignal.timeout(10_000),
    });
  } catch (error) {
    recordUpstreamRequest({
      service: "turnstile",
      operation: "/turnstile/v0/siteverify",
      outcome: "unavailable",
      durationMs: Date.now() - startedAt,
    });
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
  }

  let result: TurnstileResponse | null;

  try {
    result = await response.json() as TurnstileResponse;
  } catch (error) {
    recordUpstreamRequest({
      service: "turnstile",
      operation: "/turnstile/v0/siteverify",
      outcome: "unavailable",
      durationMs: Date.now() - startedAt,
    });
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
    hasResponse: Boolean(result),
  }, {
    category: "upstream",
    source: "turnstile.client",
    message: `HTTP Response: POST Turnstile siteverify -> ${response.status}`,
  });

  const expectedHostname = new URL(env.appUrl).hostname.toLowerCase();
  const responseHostname = result?.hostname?.toLowerCase();
  const responseAction = result?.action;
  const challengeAccepted = Boolean(
    result?.success &&
    responseHostname === expectedHostname &&
    responseAction === expectedAction,
  );

  recordUpstreamRequest({
    service: "turnstile",
    operation: "/turnstile/v0/siteverify",
    outcome: response.ok
      ? challengeAccepted ? "success" : "rejected"
      : "unavailable",
    durationMs: Date.now() - startedAt,
  });

  if (!response.ok) {
    throw new ServiceError("UPSTREAM_UNAVAILABLE", 503, "Turnstile verification unavailable", {
      upstreamStatus: response.status,
      upstreamPath: env.turnstile.verifyUrl,
    });
  }

  if (
    !challengeAccepted
  ) {
    throw new ServiceError("FORBIDDEN", 403, "Turnstile verification failed", {
      upstreamStatus: response.status,
      upstreamPath: env.turnstile.verifyUrl,
      upstreamDetail: result
        ? {
            success: result.success,
            hostnameMatches: responseHostname === expectedHostname,
            actionMatches: responseAction === expectedAction,
            errorCodes: result["error-codes"],
          }
        : null,
    });
  }
}
