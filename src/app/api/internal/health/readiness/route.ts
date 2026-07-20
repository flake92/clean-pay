import { NextResponse } from "next/server";

import { getEnv } from "@/backend/config/env";
import { runDetailedReadiness } from "@/backend/health/readiness";
import { safeEqual, sha256 } from "@/backend/security/crypto";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function hasValidSecret(request: Request) {
  const supplied = request.headers.get("x-clean-pay-readiness-secret") ?? "";
  return safeEqual(sha256(supplied), sha256(getEnv().readiness.internalSecret));
}

export async function GET(request: Request) {
  if (!hasValidSecret(request)) {
    return NextResponse.json({ error: { code: "NOT_FOUND", message: "Not found" } }, { status: 404 });
  }

  try {
    const readiness = await runDetailedReadiness();
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
  } catch {
    return NextResponse.json(
      { status: "degraded", service: "clean-pay", checkedAt: null },
      { status: 503, headers: { "cache-control": "no-store" } },
    );
  }
}
