import { completeGenericEmailAuth } from "@/backend/auth/generic-email";
import { bffError, bffJson } from "@/backend/http/bff-response";
import { readBffJsonObject } from "@/backend/http/request-body";
import { getTurnstileToken } from "@/backend/security/turnstile";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const body = await readBffJsonObject(request);
    return bffJson(
      await completeGenericEmailAuth(
        {
          email: String(body.email ?? "").trim().toLowerCase(),
          code: String(body.code ?? "").trim(),
          password: String(body.password ?? ""),
        },
        getTurnstileToken(body),
      ),
    );
  } catch (error) {
    return bffError(error);
  }
}
