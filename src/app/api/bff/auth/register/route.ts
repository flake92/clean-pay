import { bffError, bffJson } from "@/lib/bff-response";
import { isMockMode, mockAuthPayload } from "@/lib/mock-bff";
import { remnashopAuth } from "@/lib/remnashop/client";
import { createSessionFromRemnashopAuth } from "@/lib/remnashop/session";
import type { RegisterRequest } from "@/lib/remnashop/types";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as RegisterRequest;
    if (isMockMode()) {
      return bffJson(mockAuthPayload(), { status: 201 });
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
