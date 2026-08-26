import type { PaymentReconciliationBacklog } from "@/application/payments/ports/payment-maintenance";

type UpstreamMeasurement = {
  count: number;
  durationMs: number;
};

export type DatabasePoolMeasurement = {
  role: "application" | "readiness" | "retention";
  active: number;
  idle: number;
  waiting: number;
  maximum: number;
  exhausted: 0 | 1;
};

type MetricsState = {
  events: Map<string, number>;
  readinessDegraded: 0 | 1;
  upstream: Map<string, UpstreamMeasurement>;
};

const MAX_OPERATIONAL_EVENT_SERIES = 64;
const MAX_UPSTREAM_SERIES = 128;

const OPERATIONAL_EVENTS = new Set([
  "auth_concurrency_release_failed",
  "auth_concurrency_saturated",
  "chatwoot_identity_concurrency_saturated",
  "chatwoot_identity_guard_degraded",
  "chatwoot_identity_probe_coalesced",
  "chatwoot_identity_rate_limited",
  "encrypted_session_bundle_rewrapped",
  "encrypted_refresh_recovery_rewrapped",
  "encrypted_refresh_successor_rewrapped",
  "encrypted_telegram_callback_result_rewrapped",
  "rate_limit_capacity_rejected",
  "rate_limit_target_rejected",
  "refresh_token_reuse_detected",
  "refresh_token_rotation_failed",
  "telegram_callback_expired_result_scrubbed",
  "telegram_callback_lease_ownership_lost",
  "telegram_callback_oidc_dispatch_ambiguous",
  "telegram_callback_recovery_commit_resumed",
  "telegram_callback_recovery_dispatch_ambiguous",
  "telegram_callback_remnashop_dispatch_ambiguous",
  "telegram_callback_work_deadline_exceeded",
]);

const OPERATIONAL_SCOPES = new Set([
  "auth",
  "auth_command",
  "auth_identify",
  "auth_login",
  "auth_register",
  "chatwoot_identity_probe",
  "email_change_attempt",
  "email_change_cooldown",
  "email_reminder_preference",
  "email_verification_confirm",
  "email_verification_request",
  "global",
  "password_change",
  "password_reset_confirm",
  "password_reset_start",
  "passkey_login_options",
  "passkey_login_verify",
  "redis",
  "remnashop_auth",
  "remnashop_link",
  "session",
  "subscription_extend",
  "subscription_purchase",
  "telegram_account_merge_confirm",
  "telegram_link_confirm",
  "telegram_link_start",
  "telegram_login_confirm",
  "telegram_webapp_login",
  "telegram_webapp_provider",
  "turnstile_verify",
]);

const UPSTREAM_SERVICES = new Set([
  "chatwoot",
  "remnashop",
  "remnashop_admin",
  "remnawave",
  "telegram_oidc",
  "turnstile",
]);

const UPSTREAM_OPERATIONS = new Set([
  "/api/users",
  "/api/v1/widget/contact",
  "/auth/change-password",
  "/auth/email/change",
  "/auth/email/confirm",
  "/auth/email/request-verification",
  "/auth/identify",
  "/auth/login",
  "/auth/me",
  "/auth/notification-preferences",
  "/auth/password/confirm-reset",
  "/auth/password/request-reset",
  "/auth/refresh",
  "/auth/register",
  "/auth/service-session",
  "/auth/session",
  "/auth/telegram",
  "/auth/telegram/link",
  "/auth/telegram/webapp",
  "/payment-operations/:operation",
  "/referral/program",
  "/subscription/capabilities",
  "/subscription/current",
  "/subscription/devices",
  "/subscription/devices/:id",
  "/subscription/extend",
  "/subscription/offers",
  "/subscription/payment-operations/:operation",
  "/subscription/promocode",
  "/subscription/purchase",
  "/subscription/reissue",
  "/subscription/transactions",
  "/subscription/transactions/by-id/:id",
  "/subscription/transactions/page",
  "/token",
  "/turnstile/v0/siteverify",
  "/users",
  "/users/:id",
  "/users/by-email/:identity",
  "/users/by-telegram-id/:identity",
  "/users/merge",
]);

const UPSTREAM_OUTCOMES = new Set([
  "rejected",
  "success",
  "unavailable",
]);

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

function allowlistedLabel(value: string, allowed: Set<string>) {
  const normalized = boundedLabel(value);
  return allowed.has(normalized) ? normalized : "other";
}

function boundedSeriesKey<T>(
  values: Map<string, T>,
  requestedKey: string,
  overflowKey: string,
  maximum: number,
) {
  return values.has(requestedKey) || values.size < maximum - 1
    ? requestedKey
    : overflowKey;
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
  const outcome = allowlistedLabel(input.outcome, UPSTREAM_OUTCOMES);
  const requestedKey = [
    allowlistedLabel(input.service, UPSTREAM_SERVICES),
    allowlistedLabel(upstreamOperation(input.operation), UPSTREAM_OPERATIONS),
    outcome,
  ].join("|");
  const key = boundedSeriesKey(
    state().upstream,
    requestedKey,
    "other|other|other",
    MAX_UPSTREAM_SERIES,
  );
  const current = state().upstream.get(key) ?? { count: 0, durationMs: 0 };
  current.count += 1;
  current.durationMs += Math.max(0, Math.round(input.durationMs));
  state().upstream.set(key, current);
}

export function recordOperationalEvent(event: string, scope = "global") {
  const requestedKey = [
    allowlistedLabel(event, OPERATIONAL_EVENTS),
    allowlistedLabel(scope, OPERATIONAL_SCOPES),
  ].join("|");
  const key = boundedSeriesKey(
    state().events,
    requestedKey,
    "other|other",
    MAX_OPERATIONAL_EVENT_SERIES,
  );
  state().events.set(key, (state().events.get(key) ?? 0) + 1);
}

export function setReadinessMetric(status: "ok" | "degraded") {
  state().readinessDegraded = status === "degraded" ? 1 : 0;
}

function labelValue(value: string) {
  return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\n/g, "\\n");
}

export function renderPrometheusMetrics(
  backlog: PaymentReconciliationBacklog,
  databasePools: readonly DatabasePoolMeasurement[] = [],
) {
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

  if (databasePools.length > 0) {
    lines.push(
      "# HELP clean_pay_database_pool_connections PostgreSQL pool connections by fixed runtime role and state.",
      "# TYPE clean_pay_database_pool_connections gauge",
      "# HELP clean_pay_database_pool_waiting PostgreSQL callers waiting to acquire a pool connection.",
      "# TYPE clean_pay_database_pool_waiting gauge",
      "# HELP clean_pay_database_pool_maximum Configured maximum PostgreSQL connections for the pool.",
      "# TYPE clean_pay_database_pool_maximum gauge",
      "# HELP clean_pay_database_pool_exhausted Whether a PostgreSQL pool is at capacity or has queued callers.",
      "# TYPE clean_pay_database_pool_exhausted gauge",
    );
    for (const pool of [...databasePools].sort((left, right) =>
      left.role.localeCompare(right.role)
    )) {
      const role = labelValue(pool.role);
      lines.push(
        `clean_pay_database_pool_connections{role="${role}",state="active"} ${pool.active}`,
        `clean_pay_database_pool_connections{role="${role}",state="idle"} ${pool.idle}`,
        `clean_pay_database_pool_waiting{role="${role}"} ${pool.waiting}`,
        `clean_pay_database_pool_maximum{role="${role}"} ${pool.maximum}`,
        `clean_pay_database_pool_exhausted{role="${role}"} ${pool.exhausted}`,
      );
    }
  }

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
