import { createTelegramAuthorizationResponse } from "@/lib/telegram-oidc";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const redirectTo = url.searchParams.get("redirect_to") ?? undefined;

  return createTelegramAuthorizationResponse(redirectTo);
}
