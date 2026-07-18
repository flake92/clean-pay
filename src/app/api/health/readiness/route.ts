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
const readinessDeadlineMs = 8_000;

export async function GET() {
  const deadlineSignal = AbortSignal.timeout(readinessDeadlineMs);
  const [database, redis, remnashop, telegramOidc, mailpit, remnawave] = await Promise.all([
    checkDatabase(deadlineSignal),
    checkRedis(deadlineSignal),
    checkRemnashop(deadlineSignal),
    checkTelegramOidc(deadlineSignal),
    checkMailpit(deadlineSignal),
    checkRemnawave(deadlineSignal),
  ]);
  const checks: Record<string, Awaited<ReturnType<typeof checkDatabase>>> = {
    database,
    redis,
    remnashop,
    telegramOidc,
  };

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
