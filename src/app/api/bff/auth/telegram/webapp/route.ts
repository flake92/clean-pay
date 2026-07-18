import { NextResponse } from "next/server";

import { bffError } from "@/backend/http/bff-response";
import { readBffJsonObject } from "@/backend/http/request-body";
import { getRemnashopMe, remnashopAuth } from "@/backend/integrations/remnashop/client";
import { reconcileUserFromRemnashopAuth } from "@/backend/integrations/remnashop/session";
import { assertRateLimit } from "@/backend/limits/rate-limit";
import { logTechnicalInfo, logTechnicalWarning } from "@/backend/observability/audit";
import { createWebSessionOnResponse } from "@/backend/sessions/web-session";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const body = await readBffJsonObject(request);
    const initData = typeof body.initData === "string" ? body.initData.trim() : "";
    if (!initData) {
      logTechnicalWarning("telegram_webapp_auth_missing_init_data", {});
      return NextResponse.json(
        { error: { code: "BAD_REQUEST", message: "Telegram WebApp initData is required." } },
        { status: 400 },
      );
    }

    const auth = await remnashopAuth("/auth/telegram/webapp", { init_data: initData });
    const verifiedProfile = await getRemnashopMe(auth.cookies.accessToken);

    if (verifiedProfile.telegram_id === null) {
      logTechnicalWarning("telegram_webapp_auth_missing_verified_identity", {});
      return NextResponse.json(
        { error: { code: "UNAUTHORIZED", message: "Telegram identity could not be verified." } },
        { status: 401 },
      );
    }

    await assertRateLimit({
      action: "telegram_webapp_login",
      tgId: verifiedProfile.telegram_id,
      limit: 20,
      windowSeconds: 15 * 60,
    });

    const reconciled = await reconcileUserFromRemnashopAuth({
      accessToken: auth.cookies.accessToken,
      refreshToken: auth.cookies.refreshToken,
      auth: auth.data,
      verifiedProfile,
    });
    const response = NextResponse.json({ redirectTo: "/cabinet" });

    await createWebSessionOnResponse(response, reconciled.user.id, {
      remnashopSession: reconciled.remnashopSession,
    });

    logTechnicalInfo("telegram_webapp_auth_success", {
      userId: reconciled.user.id,
      telegramId: String(verifiedProfile.telegram_id),
      hasTelegramId: true,
    });

    return response;
  } catch (error) {
    return bffError(error);
  }
}
