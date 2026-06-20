import { bffError, bffJson } from "@/lib/bff-response";
import { getEnv } from "@/lib/env";
import { isMockMode, mockAuthPayload } from "@/lib/mock-bff";
import { remnashopAuth } from "@/lib/remnashop/client";
import { createSessionFromRemnashopAuth } from "@/lib/remnashop/session";
import type { RegisterRequest } from "@/lib/remnashop/types";

export const runtime = "nodejs";

function mockAuthResponse(status = 200) {
  const payload = Buffer.from(
    JSON.stringify({
      sid: 'mock-session',
      uid: 'mock-user',
      exp: Math.floor(Date.now() / 1000) + 15 * 60,
    }),
  ).toString('base64url');
  const env = getEnv();
  const response = bffJson(mockAuthPayload(), { status });

  response.cookies.set('clean_pay_access', `${payload}.mock`, {
    httpOnly: true,
    secure: env.cookieSecure,
    sameSite: env.cookieSameSite,
    path: '/',
    expires: new Date(Date.now() + 15 * 60 * 1000),
  });

  return response;
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as RegisterRequest;
    if (isMockMode()) {
      return mockAuthResponse(201);
    }

    const auth = await remnashopAuth("/auth/register", body);
    const { profile } = await createSessionFromRemnashopAuth({
      accessToken: auth.cookies.accessToken,
      refreshToken: auth.cookies.refreshToken,
      auth: auth.data,
    });

    return bffJson(
      {
        user: profile,
        expiresAt: auth.data.expires_at,
        refreshExpiresAt: auth.data.refresh_expires_at,
      },
      { status: 201 },
    );
  } catch (error) {
    return bffError(error);
  }
}
