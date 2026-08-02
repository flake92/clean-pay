import { confirmPasswordReset } from "@/backend/auth/password-reset";
import { bffError, bffJson } from "@/backend/http/bff-response";
import { readBffJsonObject } from "@/backend/http/request-body";
import { getTurnstileToken } from "@/backend/security/turnstile";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const body = await readBffJsonObject(request);
    return bffJson(
      await confirmPasswordReset(
        {
          email: String(body.email ?? "").trim().toLowerCase(),
          code: String(body.code ?? "").trim(),
          new_password: String(body.newPassword ?? ""),
        },
        getTurnstileToken(body),
      ),
    );
  } catch (error) {
    return bffError(error);
  }
}
