import { auditLog } from "@/lib/audit";
import { bffError, bffJson } from "@/lib/bff-response";
import { isMockMode, mockConfirmEmail } from "@/lib/mock-bff";
import { prisma } from "@/lib/prisma";
import { assertRateLimit } from "@/lib/rate-limit";
import {
  getAuthorizedRemnashopTokens,
  remnashopRequest,
} from "@/lib/remnashop/client";
import { verifyTurnstileToken } from "@/lib/turnstile";
import type {
  ConfirmEmailVerificationRequest,
  ConfirmEmailVerificationResponse,
} from "@/lib/remnashop/types";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const rawBody = (await request.json()) as ConfirmEmailVerificationRequest & { turnstileToken?: string };
    const { turnstileToken, ...body } = rawBody;

    await verifyTurnstileToken(turnstileToken);

    if (isMockMode()) {
      await assertRateLimit({
        action: "email_verification_confirm",
        limit: 5,
        windowSeconds: 15 * 60,
      });

      await auditLog({ action: "email_verified", metadata: { mode: "mock" } });

      return bffJson(mockConfirmEmail());
    }

    const { accessToken, session } = await getAuthorizedRemnashopTokens();

    await assertRateLimit({
      action: "email_verification_confirm",
      email: session.user.email,
      tgId: session.user.telegramId,
      limit: 5,
      windowSeconds: 15 * 60,
    });
    const result = await remnashopRequest<ConfirmEmailVerificationResponse>(
      "/auth/email/confirm",
      {
        method: "POST",
        accessToken,
        body,
      },
    );

    await prisma.webUser.update({
      where: { id: session.userId },
      data: {
        email: result.email,
        emailVerified: true,
      },
    });

    await auditLog({
      action: "email_verified",
      userId: session.userId,
      metadata: { email: result.email },
    });

    return bffJson(result);
  } catch (error) {
    return bffError(error);
  }
}
