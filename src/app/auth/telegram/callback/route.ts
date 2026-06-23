import { NextResponse } from "next/server";

import { getEnv } from "@/lib/env";
import { createWebSession } from "@/lib/session";
import { consumeTelegramCallback } from "@/lib/telegram-oidc";

export const runtime = "nodejs";

function redirectTo(path: string) {
  return NextResponse.redirect(new URL(path, getEnv().publicAppUrl));
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");

  if (!code || !state) {
    return redirectTo("/login?auth=telegram_failed");
  }

  try {
    const { user, redirectTo: nextPath } = await consumeTelegramCallback(code, state);

    await createWebSession(user.id);

    return redirectTo(nextPath ?? "/cabinet");
  } catch {
    return redirectTo("/login?auth=telegram_failed");
  }
}
