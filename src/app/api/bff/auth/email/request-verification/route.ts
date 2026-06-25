import { bffError, bffJson } from "@/backend/http/bff-response";
import type { RequestEmailVerificationRequest } from "@/shared/remnashop/types";
import { getRequestIp, getTurnstileToken } from "@/backend/security/turnstile";
import { requestEmailVerification } from "@/backend/auth/email-verification";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const rawBody = (await request.json()) as RequestEmailVerificationRequest & {
      turnstileToken?: string;
      "cf-turnstile-response"?: string;
    };

    return bffJson(
      await requestEmailVerification(rawBody, {
        token: getTurnstileToken(rawBody),
        remoteIp: getRequestIp(request),
      }),
    );
  } catch (error) {
    return bffError(error);
  }
}
