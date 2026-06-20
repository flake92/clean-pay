import { bffError, bffJson } from "@/lib/bff-response";
import { isMockMode, mockRequestVerification } from "@/lib/mock-bff";
import { assertCooldown, assertRateLimit } from "@/lib/rate-limit";
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

    return bffJson(result);
  } catch (error) {
    return bffError(error);
  }
}
