import { bffError, bffJson } from "@/lib/bff-response";
import { assertCooldown, recordRateLimitEvent } from "@/lib/rate-limit";
import {
  getAuthorizedRemnashopTokens,
  remnashopRequest,
} from "@/lib/remnashop/client";
import type {
  RequestEmailVerificationRequest,
  RequestEmailVerificationResponse,
} from "@/lib/remnashop/types";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as RequestEmailVerificationRequest;
    const { accessToken, session } = await getAuthorizedRemnashopTokens();
    const key = `email-verification:${session.userId}`;

    await assertCooldown({
      key,
      action: "email_verification_request",
      windowSeconds: 60,
    });

    const result = await remnashopRequest<RequestEmailVerificationResponse>(
      "/auth/email/request-verification",
      {
        method: "POST",
        accessToken,
        body,
      },
    );

    await recordRateLimitEvent({
      key,
      action: "email_verification_request",
      metadata: {
        targetEmail: result.target_email,
      },
    });

    return bffJson(result);
  } catch (error) {
    return bffError(error);
  }
}
