import { NextResponse } from "next/server";

import {
  aggregateStatus,
  checkDatabase,
  checkMailpit,
  checkRedis,
  checkRemnawave,
  checkRemnashop,
  checkTelegramOidc,
} from "@/backend/health/checks";

export const runtime = "nodejs";

export async function GET() {
  const checks: Record<string, Awaited<ReturnType<typeof checkDatabase>>> = {
    database: await checkDatabase(),
    redis: await checkRedis(),
    remnashop: await checkRemnashop(),
    telegramOidc: await checkTelegramOidc(),
  };
  const mailpit = await checkMailpit();
  const remnawave = await checkRemnawave();

  if (mailpit) {
    checks.mailpit = mailpit;
  }

  if (remnawave) {
    checks.remnawave = remnawave;
  }

  const status = aggregateStatus(checks);

  return NextResponse.json(
    {
      status,
      service: "clean-pay",
      version: process.env.npm_package_version ?? "0.1.0",
      checks,
    },
    { status: status === "ok" ? 200 : 503 },
  );
}
