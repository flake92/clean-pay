import { NextResponse } from "next/server";

import { runDetailedReadiness } from "@/application/health/readiness";
import { getEnv } from "@/backend/config/env";
import { createProductionReadinessGateway } from "@/backend/health/checks";
import { safeEqual, sha256 } from "@/backend/security/crypto";
import { setReadinessMetric } from "@/backend/observability/metrics";
import { APP_VERSION } from "@/shared/app-version";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function hasValidSecret(request: Request) {
  const supplied = request.headers.get("x-clean-pay-readiness-secret") ?? "";
  return safeEqual(sha256(supplied), sha256(getEnv().readiness.internalSecret));
}

export async function GET(request: Request) {
  if (!hasValidSecret(request)) {
    return NextResponse.json(
      { error: { code: "NOT_FOUND", message: "Not found" } },
      { status: 404, headers: { "cache-control": "no-store" } },
    );
  }

  try {
    const readiness = await runDetailedReadiness(createProductionReadinessGateway());
    setReadinessMetric(readiness.status);
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
  } catch {
    setReadinessMetric("degraded");
    return NextResponse.json(
      { status: "degraded", service: "clean-pay", checkedAt: null },
      { status: 503, headers: { "cache-control": "no-store" } },
    );
  }
}
