import { bffError, bffJson } from "@/lib/bff-response";
import type { ConfirmEmailVerificationRequest } from "@/lib/remnashop/types";
import { getRequestIp, getTurnstileToken } from "@/lib/turnstile";
import { confirmEmailVerification } from "@/server/auth/use-cases";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const rawBody = (await request.json()) as ConfirmEmailVerificationRequest & {
      turnstileToken?: string;
      "cf-turnstile-response"?: string;
    };

    return bffJson(
      await confirmEmailVerification(rawBody, {
        token: getTurnstileToken(rawBody),
        remoteIp: getRequestIp(request),
      }),
    );
  } catch (error) {
    return bffError(error);
  }
}
