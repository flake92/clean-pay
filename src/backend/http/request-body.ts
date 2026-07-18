import { BffError } from "@/backend/integrations/remnashop/errors";

export async function readBffJsonObject(request: Request) {
  let value: unknown;

  try {
    value = await request.json();
  } catch {
    throw new BffError("VALIDATION_ERROR", 400, "Request body must be valid JSON");
  }

  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new BffError("VALIDATION_ERROR", 400, "Request body must be a JSON object");
  }

  return value as Record<string, unknown>;
}
