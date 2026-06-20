import { bffError, bffJson } from "@/lib/bff-response";
import { isMockMode, mockConfirmEmail } from "@/lib/mock-bff";
import { prisma } from "@/lib/prisma";
import {
  getAuthorizedRemnashopTokens,
  remnashopRequest,
} from "@/lib/remnashop/client";
import type {
  ConfirmEmailVerificationRequest,
  ConfirmEmailVerificationResponse,
} from "@/lib/remnashop/types";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as ConfirmEmailVerificationRequest;
    if (isMockMode()) {
      return bffJson(mockConfirmEmail());
    }

    const { accessToken, session } = await getAuthorizedRemnashopTokens();
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

    await prisma.auditLog.create({
      data: {
        userId: session.userId,
        action: "email_verified",
        metadata: {
          email: result.email,
        },
      },
    });

    return bffJson(result);
  } catch (error) {
    return bffError(error);
  }
}
