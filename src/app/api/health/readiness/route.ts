import { NextResponse } from "next/server";

import { getPublicReadiness } from "@/backend/health/readiness";
import { APP_VERSION } from "@/shared/app-version";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const readiness = await getPublicReadiness();

  return NextResponse.json(
    {
      ...readiness,
      service: "clean-pay",
      version: APP_VERSION,
    },
    {
      status: readiness.status === "ok" ? 200 : 503,
      headers: { "cache-control": "no-store" },
    },
  );
}
