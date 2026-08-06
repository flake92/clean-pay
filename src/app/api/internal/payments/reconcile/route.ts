import { getEnv } from "@/backend/config/env";
import { ServiceError } from "@/backend/errors/service-error";
import { reconcileUnknownPayments } from "@/backend/payments/reconciliation";
import { continuePaymentHistoryBackfills } from "@/backend/payments/history-sync";
import { safeEqual, sha256 } from "@/backend/security/crypto";
import { logTechnicalError } from "@/backend/observability/audit";
import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function assertInternalSecret(request: Request, expected: string) {
  const supplied = request.headers.get("x-clean-pay-reconciliation-secret") ?? "";

  // Hashing both values first keeps the timing-safe comparison fixed length,
  // including when the supplied header is missing or malformed.
  if (!safeEqual(sha256(supplied), sha256(expected))) {
    throw new ServiceError("NOT_FOUND", 404, "Not found");
  }
}

export async function POST(request: Request) {
  try {
    const config = getEnv().paymentReconciliation;

    if (!config.enabled || !config.secret) {
      throw new ServiceError("NOT_FOUND", 404, "Not found");
    }

    assertInternalSecret(request, config.secret);
    const result = await reconcileUnknownPayments({
      limit: config.batchSize,
      deadlineMs: 12_000,
    });
    const history = await continuePaymentHistoryBackfills({
      limit: 1,
      deadlineMs: 12_000,
    });

    return NextResponse.json({ ...result, history }, {
      headers: { "cache-control": "no-store" },
    });
  } catch (error) {
    logTechnicalError("payment_reconciliation_controller_failed", error);
    if (error instanceof ServiceError && error.code === "NOT_FOUND") {
      return NextResponse.json({ error: "not_found" }, {
        status: 404,
        headers: { "cache-control": "no-store" },
      });
    }

    return NextResponse.json({ error: "internal_error" }, {
      status: 500,
      headers: { "cache-control": "no-store" },
    });
  }
}
