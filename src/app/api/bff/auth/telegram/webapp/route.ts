import { NextResponse } from "next/server";

import { bffError } from "@/backend/http/bff-response";
import { remnashopAuth } from "@/backend/integrations/remnashop/client";
import { reconcileUserFromRemnashopAuth } from "@/backend/integrations/remnashop/session";
import { assertRateLimit } from "@/backend/limits/rate-limit";
import { logTechnicalInfo, logTechnicalWarning } from "@/backend/observability/audit";
import { createWebSessionOnResponse } from "@/backend/sessions/web-session";

export const runtime = "nodejs";

function telegramIdFromInitData(initData: string) {
  const user = new URLSearchParams(initData).get("user");

  if (!user) {
    return null;
  }

  try {
    const parsed = JSON.parse(user) as { id?: unknown };

    return typeof parsed.id === "number" || typeof parsed.id === "string"
      ? String(parsed.id)
      : null;
  } catch {
    return null;
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => null) as { initData?: unknown } | null;
    const initData = typeof body?.initData === "string" ? body.initData.trim() : "";
    const telegramId = telegramIdFromInitData(initData);

    if (!initData) {
      logTechnicalWarning("telegram_webapp_auth_missing_init_data", {});
      return NextResponse.json(
        { error: { code: "BAD_REQUEST", message: "Telegram WebApp initData is required." } },
        { status: 400 },
      );
    }

    await assertRateLimit({
      action: "telegram_webapp_login",
      tgId: telegramId,
      limit: 20,
      windowSeconds: 15 * 60,
    });

    const auth = await remnashopAuth("/auth/telegram/webapp", { init_data: initData });
    const reconciled = await reconcileUserFromRemnashopAuth({
      accessToken: auth.cookies.accessToken,
      refreshToken: auth.cookies.refreshToken,
      auth: auth.data,
    });
    const response = NextResponse.json({ redirectTo: "/cabinet" });

    await createWebSessionOnResponse(response, reconciled.user.id, {
      remnashopSession: reconciled.remnashopSession,
    });

    logTechnicalInfo("telegram_webapp_auth_success", {
      userId: reconciled.user.id,
      telegramId,
      hasTelegramId: Boolean(telegramId),
    });

    return response;
  } catch (error) {
    return bffError(error);
  }
}
