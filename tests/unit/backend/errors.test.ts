import { describe, expect, it } from "vitest";

import {
  BffError,
  normalizeRemnashopError,
  remnashopInvalidJsonError,
  remnashopUnavailableError,
} from "@/backend/integrations/remnashop/errors";

describe("Remnashop BFF errors", () => {
  it("keeps production messages readable Russian", () => {
    const codes = [
      "UNAUTHORIZED",
      "AUTH_FAILED",
      "CURRENT_PASSWORD_INVALID",
      "FORBIDDEN",
      "NOT_FOUND",
      "VALIDATION_ERROR",
      "EMAIL_REQUIRED",
      "EMAIL_NOT_VERIFIED",
      "EMAIL_CODE_INVALID",
      "EMAIL_CODE_EXPIRED",
      "RATE_LIMITED",
      "CONFLICT",
      "IDEMPOTENCY_KEY_REQUIRED",
      "IDEMPOTENCY_KEY_INVALID",
      "IDEMPOTENCY_KEY_REUSED",
      "PAYMENT_OPERATION_IN_PROGRESS",
      "PAYMENT_OUTCOME_UNKNOWN",
      "PROMOCODE_ACTIVE_SUBSCRIPTION_REQUIRED",
      "PROMOCODE_ALREADY_ACTIVATED",
      "PROMOCODE_EXPIRED",
      "PROMOCODE_NOT_AVAILABLE",
      "PROMOCODE_NOT_FOUND",
      "PROMOCODE_RESOURCE_UNLIMITED",
      "PLAN_UNAVAILABLE",
      "PAYMENT_GATEWAY_UNAVAILABLE",
      "SUBSCRIPTION_NOT_FOUND",
      "SUBSCRIPTION_URL_UNAVAILABLE",
      "DEVICE_DELETE_UNAVAILABLE",
      "UPSTREAM_UNAVAILABLE",
      "UPSTREAM_ERROR",
      "INTERNAL_ERROR",
    ] as const;
    const mojibakeFragments = [
      "\u0420\u2019",
      "\u0420\u040C",
      "\u0420\u040F",
      "\u0420\u201D",
      "\u0420\u0491",
      "\u0420\u00B5",
      "\u0421\u040A",
      "\u0421\u2039",
      "\u0421\u040F",
      "\u0421\u2021",
      "\u0421\u20AC",
      "\u0421\u201A",
      "\u0421\u0402",
      "\u0421\u0192",
      "\u0432\u0402",
    ];

    for (const code of codes) {
      const error = new BffError(code, 400);

      expect(mojibakeFragments.some((fragment) => error.prodMessage.includes(fragment))).toBe(false);
      expect(error.prodMessage).toMatch(/[А-Яа-яЁё]/);
    }
  });

  it.each([
    [401, "bad credentials", "/auth/login", "AUTH_FAILED", 401],
    [401, "Current password is invalid", "/auth/change-password", "CURRENT_PASSWORD_INVALID", 401],
    [401, "missing", "/subscription/current", "UNAUTHORIZED", 401],
    [403, "blocked", "/auth/me", "FORBIDDEN", 403],
    [404, "missing", "/subscription/current", "SUBSCRIPTION_NOT_FOUND", 404],
    [404, "missing", "/plans/public", "NOT_FOUND", 404],
    [409, "email must be verified", "/subscription/purchase", "EMAIL_NOT_VERIFIED", 409],
    [400, "verification code expired", "/auth/email/confirm", "EMAIL_CODE_EXPIRED", 400],
    [400, "invalid code", "/auth/email/confirm", "EMAIL_CODE_INVALID", 400],
    [409, "plan unavailable", "/subscription/purchase", "PLAN_UNAVAILABLE", 409],
    [409, "payment gateway is not available", "/subscription/purchase", "PAYMENT_GATEWAY_UNAVAILABLE", 409],
    [409, "A request with this Idempotency-Key is already in progress", "/subscription/purchase", "PAYMENT_OPERATION_IN_PROGRESS", 409],
    [409, "The payment outcome is unknown; do not create another payment until this operation is reconciled", "/subscription/extend", "PAYMENT_OUTCOME_UNKNOWN", 409],
    [409, "The stored payment result cannot be replayed safely", "/subscription/purchase", "PAYMENT_OUTCOME_UNKNOWN", 409],
    [409, "Idempotency-Key was already used with a different request", "/subscription/purchase", "IDEMPOTENCY_KEY_REUSED", 409],
    [404, "Promocode 'IP3E3C' not found", "/subscription/promocode", "PROMOCODE_NOT_FOUND", 404],
    [409, "Promocode already activated", "/subscription/promocode", "PROMOCODE_ALREADY_ACTIVATED", 409],
    [409, "Promocode has expired", "/subscription/promocode", "PROMOCODE_EXPIRED", 409],
    [409, "Active subscription required for this promocode", "/subscription/promocode", "PROMOCODE_ACTIVE_SUBSCRIPTION_REQUIRED", 409],
    [409, "Resource is already unlimited", "/subscription/promocode", "PROMOCODE_RESOURCE_UNLIMITED", 409],
    [409, "Promocode activation limit reached", "/subscription/promocode", "PROMOCODE_NOT_AVAILABLE", 409],
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
