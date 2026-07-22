import { NextResponse } from "next/server";

import { getPublicReadiness } from "@/backend/health/readiness";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const readiness = await getPublicReadiness();

  return NextResponse.json(
    {
      ...readiness,
      service: "clean-pay",
      version: process.env.npm_package_version ?? "0.1.0",
    },
    {
      status: readiness.status === "ok" ? 200 : 503,
      headers: { "cache-control": "no-store" },
    },
  );
}
