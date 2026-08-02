import { auditLog } from "@/backend/observability/audit";
import { bffError, bffJson } from "@/backend/http/bff-response";
import type { RegisterRequest } from "@/shared/remnashop/types";
import { getTurnstileToken } from "@/backend/security/turnstile";
import { registerWithEmail } from "@/backend/auth/email-register";
import { readBffJsonObject } from "@/backend/http/request-body";

export const runtime = "nodejs";

export async function POST(request: Request) {
  let email: string | null = null;
  try {
    const body = await readBffJsonObject(request) as RegisterRequest & { turnstileToken?: string };
    email = body.email;
    return bffJson(await registerWithEmail(body, {
      token: getTurnstileToken(body),
    }), { status: 201 });
  } catch (error) {
    await auditLog({ action: "auth_register_failed", severity: "WARN", metadata: { email } });
    return bffError(error);
  }
}
