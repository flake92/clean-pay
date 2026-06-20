import { NextResponse } from "next/server";

import { createWebSession } from "@/lib/session";
import { consumeTelegramCallback } from "@/lib/telegram-oidc";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");

  if (!code || !state) {
    return NextResponse.redirect(new URL("/?auth=telegram_failed", url));
  }

  try {
    const { user, redirectTo } = await consumeTelegramCallback(code, state);

    await createWebSession(user.id);

    return NextResponse.redirect(new URL(redirectTo ?? "/", url));
  } catch {
    return NextResponse.redirect(new URL("/?auth=telegram_failed", url));
  }
}
