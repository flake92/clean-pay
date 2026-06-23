import { auditLog } from "@/lib/audit";
import { bffError, bffJson } from "@/lib/bff-response";
import { isMockMode, mockUser } from "@/lib/mock-bff";
import { assertRateLimit } from "@/lib/rate-limit";
import { remnashopAuth, remnashopRequest } from "@/lib/remnashop/client";
import { BffError } from "@/lib/remnashop/errors";
import { linkCurrentUserToRemnashopAuth } from "@/lib/remnashop/session";
import type { LoginRequest, RequestEmailVerificationResponse } from "@/lib/remnashop/types";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as LoginRequest;

    await assertRateLimit({
      action: "remnashop_link",
      email: body.email,
      limit: 10,
      windowSeconds: 15 * 60,
    });

    if (isMockMode()) {
      await auditLog({ action: "remnashop_account_linked", metadata: { email: body.email, mode: "mock" } });

      return bffJson({ user: mockUser, linked: true });
    }

    let auth: Awaited<ReturnType<typeof remnashopAuth>>;

    try {
      auth = await remnashopAuth("/auth/login", body);
    } catch (error) {
      if (!(error instanceof BffError) || error.code !== "AUTH_FAILED") {
        throw error;
      }

      auth = await remnashopAuth("/auth/register", body);
    }

    const { user, profile } = await linkCurrentUserToRemnashopAuth({
      accessToken: auth.cookies.accessToken,
      refreshToken: auth.cookies.refreshToken,
      auth: auth.data,
    });
    const verification = await remnashopRequest<RequestEmailVerificationResponse>(
      "/auth/email/request-verification",
      {
        method: "POST",
        accessToken: auth.cookies.accessToken,
        body: { email: body.email },
      },
    );

    await auditLog({
      action: "remnashop_account_linked",
      userId: user.id,
      metadata: { email: profile.email, telegramId: profile.telegram_id, verificationTargetEmail: verification.target_email },
    });

    return bffJson({
      user: profile,
      emailVerification: verification,
      linked: true,
    });
  } catch (error) {
    return bffError(error);
  }
}
