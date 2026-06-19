import { bffError, bffJson } from "@/lib/bff-response";
import { remnashopAuth } from "@/lib/remnashop/client";
import { linkCurrentUserToRemnashopAuth } from "@/lib/remnashop/session";
import type { LoginRequest } from "@/lib/remnashop/types";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as LoginRequest;
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
