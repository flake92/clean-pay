import { bffError, bffJson } from "@/lib/bff-response";
import { isMockMode, mockAuthPayload } from "@/lib/mock-bff";
import { remnashopAuth } from "@/lib/remnashop/client";
import { createSessionFromRemnashopAuth } from "@/lib/remnashop/session";
import type { LoginRequest } from "@/lib/remnashop/types";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as LoginRequest;
    if (isMockMode()) {
      return bffJson(mockAuthPayload());
    }

    const auth = await remnashopAuth("/auth/login", body);
    const { profile } = await createSessionFromRemnashopAuth({
      accessToken: auth.cookies.accessToken,
      refreshToken: auth.cookies.refreshToken,
      auth: auth.data,
    });

    return bffJson({
      user: profile,
      expiresAt: auth.data.expires_at,
      refreshExpiresAt: auth.data.refresh_expires_at,
    });
  } catch (error) {
    return bffError(error);
  }
}
