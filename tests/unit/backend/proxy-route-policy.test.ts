import { describe, expect, it } from "vitest";

import {
  accessLogRouteTemplate,
  canonicalConfusableProtectedPath,
  isBootstrapAllowedPath,
  isEmailVerificationAllowedPath,
  isInternalServiceRequest,
  isPublicPath,
  isRefreshableNavigation,
  isRemovedBrowserTransportPath,
  isRoutineReadinessProbe,
} from "@/shared/edge/proxy-route-policy";

describe("proxy route classification policy", () => {
  it("keeps the exact public, bootstrap, verification, and removed route sets", () => {
    expect([
      "/manifest.webmanifest",
      "/install",
      "/offline",
      "/login",
      "/register",
      "/support",
      "/tariffs",
      "/auth/telegram/start",
      "/auth/telegram/callback",
      "/auth/telegram/webapp",
      "/auth/session/refresh",
      "/auth/session/recover",
      "/auth/session/recovery",
      "/api/health",
      "/api/health/liveness",
      "/api/health/readiness",
      "/invite/Friend42",
    ].every(isPublicPath)).toBe(true);
    expect(isPublicPath("/auth/session/recovery-fake")).toBe(false);
    expect(isBootstrapAllowedPath("/passkey/setup")).toBe(true);
    expect(isBootstrapAllowedPath("/passkey/setup/extra")).toBe(false);
    expect(isEmailVerificationAllowedPath("/verify-email")).toBe(true);
    expect(isEmailVerificationAllowedPath("/register/verify-email")).toBe(true);
    expect(isRemovedBrowserTransportPath("/api/bff/payments/status")).toBe(true);
    expect(isRemovedBrowserTransportPath("/api/bff/payments/status/1")).toBe(false);
  });

  it("matches internal services only for their allowlisted methods", () => {
    expect(isInternalServiceRequest("/api/internal/payments/reconcile", "POST")).toBe(true);
    expect(isInternalServiceRequest("/api/internal/health/readiness", "GET")).toBe(true);
    expect(isInternalServiceRequest("/api/internal/metrics", "GET")).toBe(true);
    expect(isInternalServiceRequest("/api/internal/payments/reconcile", "GET")).toBe(false);
    expect(isInternalServiceRequest("/api/internal/health/readiness", "POST")).toBe(false);
    expect(isRoutineReadinessProbe("/api/internal/health/readiness", "GET")).toBe(true);
    expect(isRoutineReadinessProbe("/api/health/readiness", "GET")).toBe(false);
  });

  it("classifies only eligible page reads as refreshable navigation", () => {
    expect(isRefreshableNavigation("/cabinet", "GET")).toBe(true);
    expect(isRefreshableNavigation("/login", "HEAD")).toBe(true);
    expect(isRefreshableNavigation("/invite/Friend42", "GET")).toBe(true);
    expect(isRefreshableNavigation("/support", "GET")).toBe(false);
    expect(isRefreshableNavigation("/api/private", "GET")).toBe(false);
    expect(isRefreshableNavigation("/auth/custom", "GET")).toBe(false);
    expect(isRefreshableNavigation("/cabinet", "POST")).toBe(false);
  });

  it("canonicalizes only the known confusable path and templates opaque log segments", () => {
    expect(canonicalConfusableProtectedPath("/%D1%81abinet")).toBe("/cabinet");
    expect(canonicalConfusableProtectedPath("/%E0%A4%A")).toBeUndefined();
    expect(canonicalConfusableProtectedPath("/cabinet")).toBeUndefined();
    expect(accessLogRouteTemplate("/invite/ReferralCodeSecret42?source=email"))
      .toBe("/invite/:code");
    expect(accessLogRouteTemplate("/payments/dd66837a-4f64-4c60-8bca-0cbf55712abc"))
      .toBe("/payments/:id");
    expect(accessLogRouteTemplate("/operations/cm0w7x8y90000abcdefghijkl#resume"))
      .toBe("/operations/:id");
    expect(accessLogRouteTemplate("/cabinet?tab=payments")).toBe("/cabinet");
  });
});
