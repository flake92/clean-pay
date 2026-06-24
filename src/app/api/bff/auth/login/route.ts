import { auditLog } from "@/lib/audit";
import { bffError, bffJson } from "@/lib/bff-response";
import type { LoginRequest } from "@/lib/remnashop/types";
import { getRequestIp, getTurnstileToken } from "@/lib/turnstile";
import { loginWithEmail } from "@/server/auth/use-cases";

export const runtime = "nodejs";

export async function POST(request: Request) {
  let email: string | null = null;

  try {
    const rawBody = (await request.json()) as LoginRequest & {
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
