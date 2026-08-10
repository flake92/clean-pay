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
  });

  it("exports bounded counters, durations, readiness and backlog gauges", () => {
    setReadinessMetric("degraded");
    recordOperationalEvent("rate_limit_rejected", "auth");
    recordOperationalEvent("rate_limit_rejected", "auth");
    recordOperationalEvent("refresh_reuse_detected", "session");
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

    const metrics = renderPrometheusMetrics(backlog);

    expect(metrics).toContain("clean_pay_readiness_degraded 1");
    expect(metrics).toContain(
      'clean_pay_payment_reconciliation_backlog{state="manual_required"} 2',
    );
    expect(metrics).toContain(
      'clean_pay_operational_events_total{event="rate_limit_rejected",scope="auth"} 2',
    );
    expect(metrics).toContain(
      'clean_pay_upstream_requests_total{service="remnashop",operation="/users/:id",outcome="success"} 2',
    );
    expect(metrics).toContain(
      'clean_pay_upstream_request_duration_seconds_sum{service="remnashop",operation="/users/:id",outcome="success"} 0.500',
    );
    expect(metrics).not.toContain("must-not-leak");
    expect(metrics.indexOf("rate_limit_rejected")).toBeLessThan(
      metrics.indexOf("refresh_reuse_detected"),
    );
    expect(metrics.indexOf('service="remnashop"')).toBeLessThan(
      metrics.indexOf('service="telegram_oidc"'),
    );
  });

  it("resets process state deterministically between test and worker lifecycles", () => {
    recordOperationalEvent("session_rotation_failed");
    expect(renderPrometheusMetrics(backlog)).toContain("session_rotation_failed");

    resetMetricsForTests();

    expect(renderPrometheusMetrics(backlog)).not.toContain("session_rotation_failed");
  });
});
