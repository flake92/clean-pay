import { auditLog } from "@/lib/audit";
import { bffError, bffJson } from "@/lib/bff-response";
import { isMockMode, mockChangeEmail } from "@/lib/mock-bff";
import { prisma } from "@/lib/prisma";
import { getAuthorizedRemnashopTokens, remnashopRequest } from "@/lib/remnashop/client";
import type {
  ChangeEmailRequest,
  ChangeEmailResponse,
  RequestEmailVerificationResponse,
} from "@/lib/remnashop/types";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as ChangeEmailRequest;
    if (isMockMode()) {
      await auditLog({ action: "email_change_requested", metadata: { email: body.email, mode: "mock" } });

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
    const verification = await remnashopRequest<RequestEmailVerificationResponse>(
      "/auth/email/request-verification",
      {
        method: "POST",
        accessToken,
        body: { email: result.pending_email },
      },
    );

    await prisma.webUser.update({
      where: { id: session.userId },
      data: { emailVerified: false },
    });

    await auditLog({
      action: "email_change_requested",
      userId: session.userId,
      metadata: { pendingEmail: result.pending_email, verificationTargetEmail: verification.target_email },
    });

    return bffJson({ ...result, emailVerification: verification });
  } catch (error) {
    return bffError(error);
  }
}
