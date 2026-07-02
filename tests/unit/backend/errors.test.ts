import { describe, expect, it } from "vitest";

import {
  BffError,
  normalizeRemnashopError,
  remnashopInvalidJsonError,
  remnashopUnavailableError,
} from "@/backend/integrations/remnashop/errors";

describe("Remnashop BFF errors", () => {
  it.each([
    [401, "bad credentials", "/auth/login", "AUTH_FAILED", 401],
    [401, "missing", "/subscription/current", "UNAUTHORIZED", 401],
    [403, "blocked", "/auth/me", "FORBIDDEN", 403],
    [404, "missing", "/subscription/current", "SUBSCRIPTION_NOT_FOUND", 404],
    [404, "missing", "/plans/public", "NOT_FOUND", 404],
    [409, "email must be verified", "/subscription/purchase", "EMAIL_NOT_VERIFIED", 409],
    [400, "verification code expired", "/auth/email/confirm", "EMAIL_CODE_EXPIRED", 400],
    [400, "invalid code", "/auth/email/confirm", "EMAIL_CODE_INVALID", 400],
    [409, "plan unavailable", "/subscription/purchase", "PLAN_UNAVAILABLE", 409],
    [409, "payment gateway is not available", "/subscription/purchase", "PAYMENT_GATEWAY_UNAVAILABLE", 409],
    [400, "bad payload", "/auth/register", "VALIDATION_ERROR", 400],
    [422, [{ msg: "bad field" }], "/auth/register", "VALIDATION_ERROR", 400],
    [429, "slow down", "/auth/login", "RATE_LIMITED", 429],
    [500, "boom", "/plans/public", "UPSTREAM_UNAVAILABLE", 502],
  ])("maps status %s and detail %j to %s", (status, detail, path, code, mappedStatus) => {
    const error = normalizeRemnashopError(status as number, detail, { path: path as string });

    expect(error).toBeInstanceOf(BffError);
    expect(error.code).toBe(code);
    expect(error.status).toBe(mappedStatus);
    expect(error.debug?.upstreamPath).toBe(path);
  });

  it("maps device delete failures to a device-specific error", () => {
    expect(normalizeRemnashopError(400, "no", { path: "/subscription/devices/abc" }).code).toBe(
      "DEVICE_DELETE_UNAVAILABLE",
    );
    expect(normalizeRemnashopError(503, "no", { path: "/subscription/devices/abc" }).status).toBe(409);
  });

  it("wraps network and invalid-json failures", () => {
    const unavailable = remnashopUnavailableError("/plans/public", new Error("ECONNREFUSED"));
    const invalidJson = remnashopInvalidJsonError("/plans/public", "<html>");

    expect(unavailable.code).toBe("UPSTREAM_UNAVAILABLE");
    expect(unavailable.debug?.message).toBe("ECONNREFUSED");
    expect(invalidJson.code).toBe("UPSTREAM_ERROR");
    expect(invalidJson.debug?.upstreamDetail).toBe("<html>");
  });
});
