import { bffError, bffJson } from "@/backend/http/bff-response";
import { assertRateLimit } from "@/backend/limits/rate-limit";
import { BffError } from "@/backend/integrations/remnashop/errors";
import { readBffJsonObject } from "@/backend/http/request-body";

export const runtime = "nodejs";

function normalizeEmail(value: unknown) {
  return typeof value === "string" ? value.trim().toLowerCase() : "";
}

export async function POST(request: Request) {
  try {
    const rawBody = await readBffJsonObject(request);
    const email = normalizeEmail(rawBody.email);

    if (!email) {
      throw new BffError("VALIDATION_ERROR", 400, "Email is required");
    }

    await assertRateLimit({
      action: "auth_identify",
      email,
      limit: 20,
      windowSeconds: 15 * 60,
    });

    return bffJson({ accepted: true }, { status: 202 });
  } catch (error) {
    return bffError(error);
  }
}
