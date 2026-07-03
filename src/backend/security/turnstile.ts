import { getEnv } from "@/backend/config/env";
import { logger } from "@/backend/observability/logger";
import { BffError } from "@/backend/integrations/remnashop/errors";

type TurnstileResponse = {
  success?: boolean;
  "error-codes"?: string[];
};

type TurnstileBody = {
  turnstileToken?: string | null;
  "cf-turnstile-response"?: string | null;
};

export function getTurnstileToken(body: TurnstileBody) {
  return body.turnstileToken ?? body["cf-turnstile-response"] ?? null;
}

export function getRequestIp(request: Request) {
  return (
    request.headers.get("cf-connecting-ip") ??
    request.headers.get("x-real-ip") ??
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    null
  );
}

export async function verifyTurnstileToken(token: string | null | undefined, remoteIp?: string | null) {
  const env = getEnv();

  if (!env.turnstile.enabled) {
    return;
  }

  if (!env.turnstile.secretKey) {
    throw new BffError("UPSTREAM_UNAVAILABLE", 503, "TURNSTILE_SECRET_KEY is required", {
      message: "TURNSTILE_SECRET_KEY is required",
    });
  }

  if (!token) {
    throw new BffError("VALIDATION_ERROR", 400, "Turnstile token is required");
  }

  const body = new URLSearchParams({
    secret: env.turnstile.secretKey,
    response: token,
  });

  if (remoteIp) {
    body.set("remoteip", remoteIp);
  }

  let response: Response;
  const startedAt = Date.now();

  logger.info("turnstile_request_sent", {
    method: "POST",
    hasToken: Boolean(token),
    hasRemoteIp: Boolean(remoteIp),
  }, {
    category: "upstream",
    source: "turnstile.client",
    message: "HTTP Request: POST Turnstile siteverify",
  });

  try {
    response = await fetch(env.turnstile.verifyUrl, {
      method: "POST",
      body,
      cache: "no-store",
    });
  } catch (error) {
    logger.error("turnstile_request_failed", {
      method: "POST",
      durationMs: Date.now() - startedAt,
      errorName: error instanceof Error ? error.name : "UnknownError",
    }, {
      category: "upstream",
      source: "turnstile.client",
      message: "HTTP Request failed: POST Turnstile siteverify",
    });
    throw new BffError("UPSTREAM_UNAVAILABLE", 503, "Turnstile verification unavailable", {
      message: error instanceof Error ? error.message : String(error),
    });
  }

  const result = (await response.json().catch(() => null)) as TurnstileResponse | null;
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

  if (!response.ok || !result?.success) {
    throw new BffError("FORBIDDEN", 403, "Turnstile verification failed", {
      upstreamStatus: response.status,
      upstreamPath: env.turnstile.verifyUrl,
      upstreamDetail: result,
    });
  }
}

