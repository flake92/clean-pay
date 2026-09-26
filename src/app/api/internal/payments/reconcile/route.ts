import { paymentMaintenanceBatchIsHealthy, runPaymentMaintenance } from "@/application/payments/run-payment-maintenance";
import {
  getEnv,
  ServiceError,
  safeEqual,
  sha256,
  auditLogRequired,
  logTechnicalError,
} from "@/app/_composition/platform-runtime";
import { productionPaymentMaintenanceRunner } from "@/app/_composition/payment-operations-runtime";
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
    const result = await runPaymentMaintenance(productionPaymentMaintenanceRunner, {
      paymentLimit: config.batchSize,
      deadlineMs: 12_000,
    });
    const healthy = paymentMaintenanceBatchIsHealthy(result);
    await auditLogRequired({
      action: "PAYMENT_RECONCILIATION_INTERNAL_RESULT_ACCESSED",
      severity: healthy ? "INFO" : "WARN",
      metadata: {
        claimedCount: result.claimed,
        failedCount: result.failed,
        manualRequiredCount: result.manualRequiredOperationIds.length,
      },
    });

    return NextResponse.json(result, {
      status: healthy ? 200 : 503,
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
