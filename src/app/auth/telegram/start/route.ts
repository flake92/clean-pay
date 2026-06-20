import { createTelegramAuthorizationResponse } from "@/lib/telegram-oidc";
import { getCurrentUser } from "@/lib/session";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const redirectTo = url.searchParams.get("redirect_to") ?? undefined;
  const currentUser = await getCurrentUser();

  return createTelegramAuthorizationResponse(redirectTo, currentUser?.id);
}
