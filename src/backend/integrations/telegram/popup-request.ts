import { ServiceError } from "@/backend/errors/service-error";

const MAX_TELEGRAM_POPUP_BODY_BYTES = 64 * 1024;

export type TelegramPopupRequest =
  | { method: "oidc"; idToken: string }
  | { method: "login-widget"; authData: Record<string, unknown> };

async function readBody(request: Request) {
  const declaredLength = request.headers.get("content-length");

  if (declaredLength && Number(declaredLength) > MAX_TELEGRAM_POPUP_BODY_BYTES) {
    throw new ServiceError("VALIDATION_ERROR", 413, "Telegram callback payload is too large");
  }

  if (!request.body) {
    throw new ServiceError("VALIDATION_ERROR", 400, "Telegram callback payload is required");
  }

  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      totalBytes += value.byteLength;
      if (totalBytes > MAX_TELEGRAM_POPUP_BODY_BYTES) {
        await reader.cancel("Telegram callback payload limit exceeded").catch(() => undefined);
        throw new ServiceError("VALIDATION_ERROR", 413, "Telegram callback payload is too large");
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }

  const body = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }

  try {
    return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(body)) as unknown;
  } catch {
    throw new ServiceError("VALIDATION_ERROR", 400, "Telegram callback payload must be valid JSON");
  }
}

export async function readTelegramPopupRequest(request: Request): Promise<TelegramPopupRequest> {
  const contentType = request.headers.get("content-type")
    ?.split(";", 1)[0]
    ?.trim()
    .toLowerCase();

  if (contentType !== "application/json") {
    throw new ServiceError(
      "VALIDATION_ERROR",
      415,
      "Telegram callback payload must use application/json",
    );
  }

  const body = await readBody(request);

  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw new ServiceError("VALIDATION_ERROR", 400, "Telegram callback payload must be an object");
  }

  const payload = body as Record<string, unknown>;
  if (typeof payload.idToken === "string" && payload.idToken.length > 0) {
    return { method: "oidc", idToken: payload.idToken };
  }

  if (payload.authData && typeof payload.authData === "object" && !Array.isArray(payload.authData)) {
    return { method: "login-widget", authData: payload.authData as Record<string, unknown> };
  }

  throw new ServiceError("VALIDATION_ERROR", 400, "Telegram callback credentials are required");
}
