import { bffError, bffJson } from "@/lib/bff-response";
import { isMockMode, mockUser } from "@/lib/mock-bff";
import { assertRateLimit } from "@/lib/rate-limit";
import { remnashopAuth } from "@/lib/remnashop/client";
import { linkCurrentUserToRemnashopAuth } from "@/lib/remnashop/session";
import type { LoginRequest } from "@/lib/remnashop/types";

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
      return bffJson({ user: mockUser, linked: true });
    }

    const auth = await remnashopAuth("/auth/login", body);
    const { profile } = await linkCurrentUserToRemnashopAuth({
      accessToken: auth.cookies.accessToken,
      refreshToken: auth.cookies.refreshToken,
      auth: auth.data,
    });

    return bffJson({
      user: profile,
      linked: true,
    });
  } catch (error) {
    return bffError(error);
  }
}
