import { NextResponse } from "next/server";

import {
  aggregateStatus,
  checkDatabase,
  checkRedis,
  checkRemnashop,
} from "@/backend/health/checks";

export const runtime = "nodejs";

export async function GET() {
  const checks = {
    database: await checkDatabase(),
    redis: await checkRedis(),
    remnashop: await checkRemnashop(),
  };
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
