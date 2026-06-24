import { auditLog } from "@/lib/audit";
import { bffError, bffJson } from "@/lib/bff-response";
import type { RegisterRequest } from "@/lib/remnashop/types";
import { getRequestIp, getTurnstileToken } from "@/lib/turnstile";
import { registerWithEmail } from "@/server/auth/use-cases";

export const runtime = "nodejs";

export async function POST(request: Request) {
  let email: string | null = null;

  try {
    const rawBody = (await request.json()) as RegisterRequest & {
      turnstileToken?: string;
      "cf-turnstile-response"?: string;
    };
    email = rawBody.email;
    return bffJson(
      await registerWithEmail(rawBody, {
        token: getTurnstileToken(rawBody),
        remoteIp: getRequestIp(request),
      }),
      { status: 201 },
    );
  } catch (error) {
    await auditLog({ action: "auth_register_failed", severity: "WARN", metadata: { email } });

    return bffError(error);
  }
}
