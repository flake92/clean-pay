import { BffError } from "@/backend/integrations/remnashop/errors";

export const DEFAULT_BFF_JSON_LIMIT_BYTES = 64 * 1024;

function tooLarge() {
  return new BffError("VALIDATION_ERROR", 413, "Request body is too large");
}

async function readBoundedBody(request: Request, maxBytes: number) {
  const declaredLength = request.headers.get("content-length");

  if (declaredLength && Number(declaredLength) > maxBytes) throw tooLarge();
  if (!request.body) return "";

  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      totalBytes += value.byteLength;
      if (totalBytes > maxBytes) {
        await reader.cancel("request body limit exceeded").catch(() => undefined);
        throw tooLarge();
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
  return new TextDecoder("utf-8", { fatal: true }).decode(body);
}

export async function readBffJsonObject(
  request: Request,
  { maxBytes = DEFAULT_BFF_JSON_LIMIT_BYTES }: { maxBytes?: number } = {},
) {
  let value: unknown;

  if (!Number.isSafeInteger(maxBytes) || maxBytes <= 0) {
    throw new TypeError("maxBytes must be a positive safe integer");
  }

  try {
    value = JSON.parse(await readBoundedBody(request, maxBytes));
  } catch (error) {
    if (error instanceof BffError) throw error;
    throw new BffError("VALIDATION_ERROR", 400, "Request body must be valid JSON");
  }

  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new BffError("VALIDATION_ERROR", 400, "Request body must be a JSON object");
  }

  return value as Record<string, unknown>;
}
