import { loadPaymentReconciliationBacklog } from "@/application/payments/run-payment-maintenance";
import { productionPaymentMaintenanceRunner } from "@/app/_composition/payment-operations-runtime";
import {
  getEnv,
  logTechnicalError,
  renderPrometheusMetrics,
  runtimeDatabasePoolMetrics,
  safeEqual,
  sha256,
} from "@/app/_composition/platform-runtime";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function authorized(request: Request) {
  const supplied = request.headers.get("x-clean-pay-readiness-secret") ?? "";
  return safeEqual(
    sha256(supplied),
    sha256(getEnv().readiness.internalSecret),
  );
}

export async function GET(request: Request) {
  try {
    if (!authorized(request)) {
      return Response.json({ error: "not_found" }, {
        status: 404,
        headers: { "cache-control": "no-store" },
      });
    }

    const backlog = await loadPaymentReconciliationBacklog(
      productionPaymentMaintenanceRunner,
    );
    return new Response(renderPrometheusMetrics(
      backlog,
      runtimeDatabasePoolMetrics(),
    ), {
      status: 200,
      headers: {
        "cache-control": "no-store",
        "content-type": "text/plain; version=0.0.4; charset=utf-8",
      },
    });
  } catch (error) {
    logTechnicalError("internal_metrics_failed", error);
    return new Response("metrics unavailable\n", {
      status: 503,
      headers: {
        "cache-control": "no-store",
        "content-type": "text/plain; charset=utf-8",
      },
    });
  }
}
