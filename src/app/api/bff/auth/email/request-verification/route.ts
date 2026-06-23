import { auditLog } from "@/lib/audit";
import { bffError, bffJson } from "@/lib/bff-response";
import { isMockMode, mockRequestVerification } from "@/lib/mock-bff";
import { assertCooldown, assertRateLimit } from "@/lib/rate-limit";
import {
  getAuthorizedRemnashopTokens,
  remnashopRequest,
} from "@/lib/remnashop/client";
import { getRequestIp, getTurnstileToken, verifyTurnstileToken } from "@/lib/turnstile";
import type {
  RequestEmailVerificationRequest,
  RequestEmailVerificationResponse,
} from "@/lib/remnashop/types";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const rawBody = (await request.json()) as RequestEmailVerificationRequest & { turnstileToken?: string; "cf-turnstile-response"?: string };
    const turnstileToken = getTurnstileToken(rawBody);
    const body = { ...rawBody };
    delete body.turnstileToken;
    delete body["cf-turnstile-response"];

    await verifyTurnstileToken(turnstileToken, getRequestIp(request));

    if (isMockMode()) {
      await assertCooldown({
        key: body.email ?? "mock-email-verification",
        action: "email_verification_request",
        windowSeconds: 60,
      });
      await assertRateLimit({
        action: "email_verification_request",
        email: body.email,
        limit: 5,
        windowSeconds: 15 * 60,
      });

      await auditLog({ action: "email_verification_requested", metadata: { email: body.email, mode: "mock" } });

      return bffJson(mockRequestVerification());
    }

    const { accessToken, session } = await getAuthorizedRemnashopTokens();
    const key = `email-verification:${session.userId}`;

    await assertCooldown({
      key,
      action: "email_verification_request",
      windowSeconds: 60,
    });
    await assertRateLimit({
      action: "email_verification_request",
      email: body.email ?? session.user.email,
      tgId: session.user.telegramId,
      limit: 5,
      windowSeconds: 15 * 60,
    });

    const result = await remnashopRequest<RequestEmailVerificationResponse>(
      "/auth/email/request-verification",
      {
        method: "POST",
        accessToken,
        body,
      },
    );

    await auditLog({
      action: "email_verification_requested",
      userId: session.userId,
      metadata: { targetEmail: result.target_email },
    });

    return bffJson(result);
  } catch (error) {
    return bffError(error);
  }
}
