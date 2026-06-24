import { bffError, bffJson } from "@/lib/bff-response";
import type { RequestEmailVerificationRequest } from "@/lib/remnashop/types";
import { getRequestIp, getTurnstileToken } from "@/lib/turnstile";
import { requestEmailVerification } from "@/server/auth/use-cases";

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
