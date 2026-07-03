import { describe, expect, it } from "vitest";

import { endpointMatrix } from "../../e2e/full-stack/endpoint-matrix";

const requiredEndpoints = [
  "GET /api/health",
  "GET /api/health/liveness",
  "GET /api/health/readiness",
  "GET /api/me",
  "POST /api/logout",
  "GET /api/bff/auth/me",
  "POST /api/bff/auth/identify",
  "POST /api/bff/auth/logout",
  "POST /api/bff/auth/email/request-verification",
  "POST /api/bff/auth/email/confirm",
  "POST /api/bff/auth/email/change",
  "POST /api/bff/auth/change-password",
  "POST /api/bff/auth/telegram/webapp",
  "GET /auth/telegram/callback?code=bad-code&state=bad-state",
  "POST /api/bff/auth/passkey/register/options",
  "POST /api/bff/auth/passkey/register/verify",
  "POST /api/bff/auth/passkey/login/options",
  "POST /api/bff/auth/passkey/login/verify",
  "GET /api/bff/auth/passkey/credentials",
  "DELETE /api/bff/auth/passkey/credentials/missing",
  "GET /api/bff/plans/public",
  "GET /api/bff/subscription/current",
  "GET /api/bff/subscription/offers",
  "GET /api/bff/subscription/devices",
  "DELETE /api/bff/subscription/devices",
  "DELETE /api/bff/subscription/devices/missing-device",
  "POST /api/bff/subscription/promocode",
  "POST /api/bff/subscription/reissue",
  "POST /api/bff/subscription/purchase",
  "POST /api/bff/subscription/extend",
  "GET /api/bff/payments/history",
  "GET /api/bff/payments/status",
  "GET /api/bff/support",
];

describe("e2e endpoint matrix artifact", () => {
  it("records session, verified email, upstream and 5xx expectations for every case", () => {
    expect(endpointMatrix.length).toBeGreaterThan(50);

    for (const entry of endpointMatrix) {
      expect(entry.method).toMatch(/^(GET|POST|DELETE)$/);
      expect(entry.path).toMatch(/^\//);
      expect(["none", "unverified-email", "telegram"]).toContain(entry.session);
      expect(["not-required", "required", "blocked-until-verified"]).toContain(entry.verifiedEmail);
      expect(entry.upstream.length, `${entry.method} ${entry.path}`).toBeGreaterThan(0);
      expect(entry.unexpected5xx).toBe("bug");

      if (entry.statuses) {
        expect(entry.statuses.every((status) => status < 500), `${entry.method} ${entry.path}`).toBe(true);
      }
    }
  });

  it("covers the task endpoint list with explicit matrix rows", () => {
    const covered = new Set(endpointMatrix.map((entry) => `${entry.method} ${entry.path}`));

    for (const endpoint of requiredEndpoints) {
      expect(covered.has(endpoint), endpoint).toBe(true);
    }
  });

  it("marks real upstream-backed flows instead of treating 401 as enough", () => {
    expect(endpointMatrix).toEqual(expect.arrayContaining([
      expect.objectContaining({
        method: "POST",
        path: "/api/bff/auth/email/request-verification",
        session: "unverified-email",
        upstream: expect.arrayContaining(["remnashop", "mailpit"]),
      }),
      expect.objectContaining({
        method: "GET",
        path: "/api/health/readiness",
        upstream: expect.arrayContaining(["postgres", "redis", "remnashop", "mailpit", "telegram-oidc", "remnawave"]),
      }),
      expect.objectContaining({
        method: "GET",
        path: "/api/bff/subscription/current",
        session: "telegram",
        upstream: expect.arrayContaining(["remnashop", "remnawave"]),
      }),
    ]));
  });
});
