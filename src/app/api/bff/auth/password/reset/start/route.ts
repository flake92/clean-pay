import { requestPasswordReset } from "@/backend/auth/password-reset";
import { bffError, bffJson } from "@/backend/http/bff-response";
import { readBffJsonObject } from "@/backend/http/request-body";
import { getTurnstileToken } from "@/backend/security/turnstile";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const body = await readBffJsonObject(request);
    return bffJson(
      await requestPasswordReset(
        { email: String(body.email ?? "").trim().toLowerCase() },
        getTurnstileToken(body),
      ),
      { status: 202 },
    );
  } catch (error) {
    return bffError(error);
  }
}
