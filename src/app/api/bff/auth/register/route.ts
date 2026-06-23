import { auditLog } from "@/lib/audit";
import { bffError, bffJson } from "@/lib/bff-response";
import { getEnv } from "@/lib/env";
import { isMockMode, mockAuthPayload } from "@/lib/mock-bff";
import { assertRateLimit } from "@/lib/rate-limit";
import { remnashopAuth, remnashopRequest } from "@/lib/remnashop/client";
import { getRequestIp, getTurnstileToken, verifyTurnstileToken } from "@/lib/turnstile";
import { createSessionFromRemnashopAuth } from "@/lib/remnashop/session";
import type { RegisterRequest, RequestEmailVerificationResponse } from "@/lib/remnashop/types";

export const runtime = "nodejs";

function mockAuthResponse(status = 200) {
  const payload = Buffer.from(
    JSON.stringify({
      sid: "mock-session",
      uid: "mock-user",
      exp: Math.floor(Date.now() / 1000) + 15 * 60,
    }),
  ).toString("base64url");
  const env = getEnv();
  const response = bffJson(mockAuthPayload(), { status });

  response.cookies.set("clean_pay_access", `${payload}.mock`, {
    httpOnly: true,
    secure: env.cookieSecure,
    sameSite: env.cookieSameSite,
    path: "/",
    expires: new Date(Date.now() + 15 * 60 * 1000),
  });

  return response;
}

export async function POST(request: Request) {
  let email: string | null = null;

  try {
    const rawBody = (await request.json()) as RegisterRequest & { turnstileToken?: string; "cf-turnstile-response"?: string };
    const turnstileToken = getTurnstileToken(rawBody);
    const body = { ...rawBody };
    delete body.turnstileToken;
    delete body["cf-turnstile-response"];
    email = body.email;

    await verifyTurnstileToken(turnstileToken, getRequestIp(request));

    await assertRateLimit({
      action: "auth_register",
      email: body.email,
      limit: 5,
      windowSeconds: 15 * 60,
    });

    if (isMockMode()) {
      await auditLog({ action: "auth_register_success", metadata: { email, mode: "mock" } });

      return mockAuthResponse(201);
    }

    const auth = await remnashopAuth("/auth/register", body);
    const { user, profile } = await createSessionFromRemnashopAuth({
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
      action: "auth_register_success",
      userId: user.id,
      metadata: { email: user.email, telegramId: user.telegramId, verificationTargetEmail: verification.target_email },
    });

    return bffJson(
      {
        user: profile,
        expiresAt: auth.data.expires_at,
        refreshExpiresAt: auth.data.refresh_expires_at,
        emailVerification: verification,
      },
      { status: 201 },
    );
  } catch (error) {
    await auditLog({ action: "auth_register_failed", severity: "WARN", metadata: { email } });

    return bffError(error);
  }
}
