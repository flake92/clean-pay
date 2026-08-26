import { beforeEach, describe, expect, it } from "vitest";

import {
  recordOperationalEvent,
  recordUpstreamRequest,
  renderPrometheusMetrics,
  resetMetricsForTests,
  setReadinessMetric,
  upstreamOperation,
} from "@/backend/observability/metrics";

const backlog = {
  pending: 7,
  due: 3,
  manualRequired: 2,
  oldestAgeSeconds: 901,
  maximumAttemptCount: 4,
  totalFailureCount: 9,
};

describe("operational metrics", () => {
  beforeEach(() => resetMetricsForTests());

  it("normalizes identifiers and query values out of upstream labels", () => {
    expect(upstreamOperation("/payments/123?token=secret")).toBe("/payments/:id");
    expect(
      upstreamOperation("/users/123e4567-e89b-12d3-a456-426614174000"),
    ).toBe("/users/:id");
    expect(upstreamOperation("/users/by-email/Person@Example.com")).toBe(
      "/users/by-email/:identity",
    );
    expect(upstreamOperation("/users/provider-user-42")).toBe("/users/:id");
    expect(upstreamOperation("/subscription/devices/device-HWID.secret")).toBe(
      "/subscription/devices/:id",
    );
    expect(upstreamOperation("/subscription/transactions/by-id/provider-payment-A"))
      .toBe("/subscription/transactions/by-id/:id");
    expect(upstreamOperation("/subscription/payment-operations/purchase"))
      .toBe("/subscription/payment-operations/:operation");
    expect(upstreamOperation("/users/merge?dry_run=true")).toBe("/users/merge");
  });

  it("exports bounded counters, durations, readiness and backlog gauges", () => {
    setReadinessMetric("degraded");
    recordOperationalEvent("rate_limit_target_rejected", "auth");
    recordOperationalEvent("rate_limit_target_rejected", "auth");
    recordOperationalEvent("refresh_token_reuse_detected", "session");
    recordOperationalEvent("telegram_callback_recovery_dispatch_ambiguous");
    recordUpstreamRequest({
      service: "Remnashop",
      operation: "/users/42?api_key=must-not-leak",
      outcome: "success",
      durationMs: 125,
    });
    recordUpstreamRequest({
      service: "Remnashop",
      operation: "/users/87?api_key=must-not-leak",
      outcome: "success",
      durationMs: 375,
    });
    recordUpstreamRequest({
      service: "Telegram_OIDC",
      operation: "/token",
      outcome: "rejected",
      durationMs: 10,
    });
    recordUpstreamRequest({
      service: "Remnashop",
      operation: "/subscription/devices/first-private-hwid",
      outcome: "success",
      durationMs: 20,
    });
    recordUpstreamRequest({
      service: "Remnashop",
      operation: "/subscription/devices/second-private-hwid",
      outcome: "success",
      durationMs: 30,
    });

    const metrics = renderPrometheusMetrics(backlog, [
      {
        role: "application",
        active: 8,
        idle: 0,
        waiting: 3,
        maximum: 8,
        exhausted: 1,
      },
      {
        role: "readiness",
        active: 0,
        idle: 1,
        waiting: 0,
        maximum: 1,
        exhausted: 0,
      },
    ]);

    expect(metrics).toContain("clean_pay_readiness_degraded 1");
    expect(metrics).toContain(
      'clean_pay_payment_reconciliation_backlog{state="manual_required"} 2',
    );
    expect(metrics).toContain(
      'clean_pay_database_pool_connections{role="application",state="active"} 8',
    );
    expect(metrics).toContain(
      'clean_pay_database_pool_waiting{role="application"} 3',
    );
    expect(metrics).toContain(
      'clean_pay_database_pool_exhausted{role="application"} 1',
    );
    expect(metrics).toContain(
      'clean_pay_database_pool_exhausted{role="readiness"} 0',
    );
    expect(metrics).toContain(
      'clean_pay_operational_events_total{event="rate_limit_target_rejected",scope="auth"} 2',
    );
    expect(metrics).toContain(
      'clean_pay_operational_events_total{event="telegram_callback_recovery_dispatch_ambiguous",scope="global"} 1',
    );
    expect(metrics).toContain(
      'clean_pay_upstream_requests_total{service="remnashop",operation="/users/:id",outcome="success"} 2',
    );
    expect(metrics).toContain(
      'clean_pay_upstream_request_duration_seconds_sum{service="remnashop",operation="/users/:id",outcome="success"} 0.500',
    );
    expect(metrics).not.toContain("must-not-leak");
    expect(metrics).toContain(
      'clean_pay_upstream_requests_total{service="remnashop",operation="/subscription/devices/:id",outcome="success"} 2',
    );
    expect(metrics).not.toContain("private-hwid");
    expect(metrics.indexOf("rate_limit_target_rejected")).toBeLessThan(
      metrics.indexOf("refresh_token_reuse_detected"),
    );
    expect(metrics.indexOf('service="remnashop"')).toBeLessThan(
      metrics.indexOf('service="telegram_oidc"'),
    );
  });

  it("resets process state deterministically between test and worker lifecycles", () => {
    recordOperationalEvent("refresh_token_rotation_failed");
    expect(renderPrometheusMetrics(backlog)).toContain("refresh_token_rotation_failed");

    resetMetricsForTests();

    expect(renderPrometheusMetrics(backlog)).not.toContain("refresh_token_rotation_failed");
  });

  it("collapses unmodelled labels and keeps adversarial cardinality fixed", () => {
    for (let index = 0; index < 10_000; index += 1) {
      recordOperationalEvent(`future_event_${index}`, `tenant_${index}`);
      recordUpstreamRequest({
        service: `future_service_${index}`,
        operation: `/unmodelled/${index}`,
        outcome: `future_outcome_${index}` as never,
        durationMs: 1,
      });
    }

    const metrics = renderPrometheusMetrics(backlog);
    const eventSeries = metrics
      .split("\n")
      .filter((line) => line.startsWith("clean_pay_operational_events_total{"));
    const upstreamSeries = metrics
      .split("\n")
      .filter((line) => line.startsWith("clean_pay_upstream_requests_total{"));

    expect(eventSeries).toEqual([
      'clean_pay_operational_events_total{event="other",scope="other"} 10000',
    ]);
    expect(upstreamSeries).toEqual([
      'clean_pay_upstream_requests_total{service="other",operation="other",outcome="other"} 10000',
    ]);
    expect(metrics).not.toContain("future_event_");
    expect(metrics).not.toContain("unmodelled");
    expect(metrics).not.toContain("future_outcome_");
  });

  it("reserves the final series slot for overflow of valid allowlisted combinations", () => {
    const events = [
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
    ];
    const scopes = [
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
    ];

    for (const event of events) {
      for (const scope of scopes) {
        recordOperationalEvent(event, scope);
      }
    }

    const series = renderPrometheusMetrics(backlog)
      .split("\n")
      .filter((line) => line.startsWith("clean_pay_operational_events_total{"));

    expect(series.length).toBeLessThanOrEqual(64);
    expect(series.some((line) =>
      line.startsWith('clean_pay_operational_events_total{event="other",scope="other"}')
    )).toBe(true);
  });

  it("keeps 10k allowlisted multi-outcome upstream observations within 128 total series", () => {
    const services = [
      "chatwoot",
      "remnashop",
      "remnashop_admin",
      "remnawave",
      "telegram_oidc",
      "turnstile",
    ];
    const operations = [
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
    ];
    const outcomes = ["success", "rejected", "unavailable"] as const;

    for (let index = 0; index < 10_000; index += 1) {
      recordUpstreamRequest({
        service: services[Math.floor(index / outcomes.length) % services.length]!,
        operation: operations[
          Math.floor(index / (outcomes.length * services.length)) % operations.length
        ]!,
        outcome: outcomes[index % outcomes.length]!,
        durationMs: 1,
      });
    }

    const series = renderPrometheusMetrics(backlog)
      .split("\n")
      .filter((line) => line.startsWith("clean_pay_upstream_requests_total{"));
    const observations = series.reduce((sum, line) =>
      sum + Number(line.slice(line.lastIndexOf(" ") + 1)), 0);

    expect(series).toHaveLength(128);
    expect(series.filter((line) =>
      line.startsWith(
        'clean_pay_upstream_requests_total{service="other",operation="other",outcome="other"}',
      )
    )).toHaveLength(1);
    expect(series.some((line) => line.includes('outcome="success"'))).toBe(true);
    expect(series.some((line) => line.includes('outcome="rejected"'))).toBe(true);
    expect(series.some((line) => line.includes('outcome="unavailable"'))).toBe(true);
    expect(observations).toBe(10_000);
  });
});
