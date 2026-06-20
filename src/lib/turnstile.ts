import { getEnv } from "@/lib/env";
import { BffError } from "@/lib/remnashop/errors";

type TurnstileResponse = {
  success?: boolean;
  "error-codes"?: string[];
};

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

  try {
    response = await fetch(env.turnstile.verifyUrl, {
      method: "POST",
      body,
      cache: "no-store",
    });
  } catch (error) {
    throw new BffError("UPSTREAM_UNAVAILABLE", 503, "Turnstile verification unavailable", {
      message: error instanceof Error ? error.message : String(error),
    });
  }

  const result = (await response.json().catch(() => null)) as TurnstileResponse | null;

  if (!response.ok || !result?.success) {
    throw new BffError("FORBIDDEN", 403, "Turnstile verification failed", {
      upstreamStatus: response.status,
      upstreamPath: env.turnstile.verifyUrl,
      upstreamDetail: result,
    });
  }
}
