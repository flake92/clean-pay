import { auditLog } from "@/backend/observability/audit";
import { bffError, bffJson } from "@/backend/http/bff-response";
import type { LoginRequest } from "@/shared/remnashop/types";
import { getRequestIp, getTurnstileToken } from "@/backend/security/turnstile";
import { loginWithEmail } from "@/backend/auth/email-login";
import { readBffJsonObject } from "@/backend/http/request-body";

export const runtime = "nodejs";

export async function POST(request: Request) {
  let email: string | null = null;

  try {
    const rawBody = (await readBffJsonObject(request)) as LoginRequest & {
      turnstileToken?: string;
      "cf-turnstile-response"?: string;
    };
    email = rawBody.email;
    return bffJson(
      await loginWithEmail(rawBody, {
        token: getTurnstileToken(rawBody),
        remoteIp: getRequestIp(request),
      }),
    );
  } catch (error) {
    await auditLog({ action: "auth_login_failed", severity: "WARN", metadata: { email } });

    return bffError(error);
  }
}
