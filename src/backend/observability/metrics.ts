import type { PaymentReconciliationBacklog } from "@/application/payments/ports/payment-maintenance";

type UpstreamMeasurement = {
  count: number;
  durationMs: number;
};

type MetricsState = {
  events: Map<string, number>;
  readinessDegraded: 0 | 1;
  upstream: Map<string, UpstreamMeasurement>;
};

const globalMetrics = globalThis as typeof globalThis & {
  cleanPayMetricsState?: MetricsState;
};

function state() {
  globalMetrics.cleanPayMetricsState ??= {
    events: new Map(),
    readinessDegraded: 0,
    upstream: new Map(),
  };
  return globalMetrics.cleanPayMetricsState;
}

function boundedLabel(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9_.:/-]+/g, "_")
    .slice(0, 120) || "unknown";
}

export function upstreamOperation(path: string) {
  return boundedLabel(
    path.split("?", 1)[0]!
      .replace(/\/subscription\/devices\/[^/]+(?=\/|$)/gi, "/subscription/devices/:id")
      .replace(/\/subscription\/transactions\/by-id\/[^/]+(?=\/|$)/gi, "/subscription/transactions/by-id/:id")
      .replace(/\/(?:subscription\/)?payment-operations\/[^/]+(?=\/|$)/gi, (match) => (
        match.replace(/\/[^/]+$/, "/:operation")
      ))
      .replace(/\/users\/(?:by-email|by-telegram-id)\/[^/]+(?=\/|$)/gi, (match) => (
        match.replace(/\/[^/]+$/, "/:identity")
      ))
      .replace(/\/users\/(?!by-email(?:\/|$)|by-telegram-id(?:\/|$)|merge(?:\/|$))[^/]+(?=\/|$)/gi, "/users/:id")
      .replace(/[0-9a-f]{8}-[0-9a-f-]{27,}/gi, ":id")
      .replace(/\/(?:by-email|by-telegram-id)\/[^/]+$/i, (match) => (
        match.replace(/\/[^/]+$/, "/:identity")
      ))
      .replace(/\/\d+(?=\/|$)/g, "/:id"),
  );
}

export function recordUpstreamRequest(input: {
  service: string;
  operation: string;
  outcome: "success" | "rejected" | "unavailable";
  durationMs: number;
}) {
  const key = [
    boundedLabel(input.service),
    upstreamOperation(input.operation),
    input.outcome,
  ].join("|");
  const current = state().upstream.get(key) ?? { count: 0, durationMs: 0 };
  current.count += 1;
  current.durationMs += Math.max(0, Math.round(input.durationMs));
  state().upstream.set(key, current);
}

export function recordOperationalEvent(event: string, scope = "global") {
  const key = `${boundedLabel(event)}|${boundedLabel(scope)}`;
  state().events.set(key, (state().events.get(key) ?? 0) + 1);
}

export function setReadinessMetric(status: "ok" | "degraded") {
  state().readinessDegraded = status === "degraded" ? 1 : 0;
}

function labelValue(value: string) {
  return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\n/g, "\\n");
}

export function renderPrometheusMetrics(backlog: PaymentReconciliationBacklog) {
  const lines = [
    "# HELP clean_pay_readiness_degraded Whether the latest detailed readiness check was degraded.",
    "# TYPE clean_pay_readiness_degraded gauge",
    `clean_pay_readiness_degraded ${state().readinessDegraded}`,
    "# HELP clean_pay_payment_reconciliation_backlog Payment operations waiting for automated recovery.",
    "# TYPE clean_pay_payment_reconciliation_backlog gauge",
    `clean_pay_payment_reconciliation_backlog{state=\"pending\"} ${backlog.pending}`,
    `clean_pay_payment_reconciliation_backlog{state=\"due\"} ${backlog.due}`,
    `clean_pay_payment_reconciliation_backlog{state=\"manual_required\"} ${backlog.manualRequired}`,
    "# HELP clean_pay_payment_reconciliation_oldest_age_seconds Age of the oldest unresolved operation.",
    "# TYPE clean_pay_payment_reconciliation_oldest_age_seconds gauge",
    `clean_pay_payment_reconciliation_oldest_age_seconds ${backlog.oldestAgeSeconds}`,
    "# HELP clean_pay_payment_reconciliation_maximum_attempt_count Highest recovery attempt count.",
    "# TYPE clean_pay_payment_reconciliation_maximum_attempt_count gauge",
    `clean_pay_payment_reconciliation_maximum_attempt_count ${backlog.maximumAttemptCount}`,
    "# HELP clean_pay_payment_reconciliation_failure_count Total failed recovery attempts in the active/manual queue.",
    "# TYPE clean_pay_payment_reconciliation_failure_count gauge",
    `clean_pay_payment_reconciliation_failure_count ${backlog.totalFailureCount}`,
    "# HELP clean_pay_operational_events_total Security and reliability control events.",
    "# TYPE clean_pay_operational_events_total counter",
  ];

  for (const [key, count] of [...state().events].sort(([left], [right]) => left.localeCompare(right))) {
    const [event, scope] = key.split("|");
    lines.push(`clean_pay_operational_events_total{event=\"${labelValue(event!)}\",scope=\"${labelValue(scope!)}\"} ${count}`);
  }

  lines.push(
    "# HELP clean_pay_upstream_requests_total Upstream HTTP calls by normalized operation and outcome.",
    "# TYPE clean_pay_upstream_requests_total counter",
    "# HELP clean_pay_upstream_request_duration_seconds Upstream HTTP request duration by normalized operation and outcome.",
    "# TYPE clean_pay_upstream_request_duration_seconds summary",
  );
  for (const [key, measurement] of [...state().upstream].sort(([left], [right]) => left.localeCompare(right))) {
    const [service, operation, outcome] = key.split("|");
    const labels = `service=\"${labelValue(service!)}\",operation=\"${labelValue(operation!)}\",outcome=\"${labelValue(outcome!)}\"`;
    lines.push(`clean_pay_upstream_requests_total{${labels}} ${measurement.count}`);
    lines.push(`clean_pay_upstream_request_duration_seconds_sum{${labels}} ${(measurement.durationMs / 1_000).toFixed(3)}`);
    lines.push(`clean_pay_upstream_request_duration_seconds_count{${labels}} ${measurement.count}`);
  }

  return `${lines.join("\n")}\n`;
}

export function resetMetricsForTests() {
  delete globalMetrics.cleanPayMetricsState;
}
