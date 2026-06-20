import { bffError, bffJson } from "@/lib/bff-response";
import { isMockMode, mockChangeEmail } from "@/lib/mock-bff";
import { prisma } from "@/lib/prisma";
import { getAuthorizedRemnashopTokens, remnashopRequest } from "@/lib/remnashop/client";
import type {
  ChangeEmailRequest,
  ChangeEmailResponse,
} from "@/lib/remnashop/types";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as ChangeEmailRequest;
    if (isMockMode()) {
      return bffJson(mockChangeEmail());
    }

    const { accessToken, session } = await getAuthorizedRemnashopTokens();
    const result = await remnashopRequest<ChangeEmailResponse>(
      "/auth/email/change",
      {
        method: "POST",
        accessToken,
        body,
      },
    );

    await prisma.webUser.update({
      where: { id: session.userId },
      data: { emailVerified: false },
    });

    await prisma.auditLog.create({
      data: {
        userId: session.userId,
        action: "email_change_requested",
        metadata: { pendingEmail: result.pending_email },
      },
    });

    return bffJson(result);
  } catch (error) {
    return bffError(error);
  }
}
