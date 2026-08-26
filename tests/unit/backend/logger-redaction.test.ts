import { describe, expect, it, vi } from "vitest";

import { logEventBus, logger, sanitizeLogValue } from "@/backend/observability/logger";
import { authDebugLog } from "@/backend/observability/auth-debug-log";

describe("identity log redaction", () => {
  it("removes raw PII and internal identity values while preserving booleans", () => {
    const sanitized = sanitizeLogValue({
      email: "user@example.com",
      telegramId: "123456789",
      userId: "user-internal-id",
      sessionId: "session-internal-id",
      operationId: "operation-internal-id",
      paymentId: "payment-internal-id",
      hwid: "device-hardware-id",
      nested: { remnashopUserId: "upstream-id" },
      linkUserId: "linked-user-id",
      authStateId: "auth-state-id",
      accountId: "provider-account-id",
      telegramUsername: "private_username",
      fullName: "Private Person",
      photoUrl: "https://example.com/private-photo",
      hasTelegramId: true,
      requestId: "trace-safe-to-retain",
      traceId: "trace-id-safe-to-retain",
    });

    expect(sanitized).toEqual({
      email: "[redacted]",
      telegramId: "[redacted]",
      userId: "[redacted]",
      sessionId: "[redacted]",
      operationId: "[redacted]",
      paymentId: "[redacted]",
      hwid: "[redacted]",
      nested: { remnashopUserId: "[redacted]" },
      linkUserId: "[redacted]",
      authStateId: "[redacted]",
      accountId: "[redacted]",
      telegramUsername: "[redacted]",
      fullName: "[redacted]",
      photoUrl: "[redacted]",
      hasTelegramId: true,
      requestId: "trace-safe-to-retain",
      traceId: "trace-id-safe-to-retain",
    });
    expect(JSON.stringify(sanitized)).not.toContain("123456789");
    expect(JSON.stringify(sanitized)).not.toContain("user@example.com");
  });

  it("redacts credentials and email addresses embedded in unstructured errors", () => {
    const sanitized = sanitizeLogValue({
      error: "SMTP failed for user@example.com; password=\"two word secret\" token='abc.def' Authorization: Bearer bearer-secret",
    });

    expect(JSON.stringify(sanitized)).not.toContain("user@example.com");
    expect(JSON.stringify(sanitized)).not.toContain("two word secret");
    expect(JSON.stringify(sanitized)).not.toContain("abc.def");
    expect(JSON.stringify(sanitized)).not.toContain("bearer-secret");
    expect(sanitized).toEqual({
      error: expect.stringContaining("SMTP failed"),
    });
  });

  it("redacts exact sensitive field names regardless of their casing", () => {
    const sanitized = sanitizeLogValue({
      Response: "provider-secret",
      "CF-Turnstile-Response": "challenge-secret",
      TURNSTILETOKEN: "turnstile-secret",
    });

    expect(sanitized).toEqual({
      Response: "[redacted]",
      "CF-Turnstile-Response": "[redacted]",
      TURNSTILETOKEN: "[redacted]",
    });
  });

  it("does not crash the logger on circular metadata", () => {
    const circular: Record<string, unknown> = { safe: true };
    circular.self = circular;

    expect(sanitizeLogValue(circular)).toEqual({
      safe: true,
      self: "[circular]",
    });
  });

  it("sanitizes valid and invalid dates without throwing", () => {
    const valid = new Date("2026-08-26T10:00:00.000Z");
    const invalid = new Date(Number.NaN);
    const error = new Error("ordinary failure");

    expect(() => sanitizeLogValue({ valid, invalid, error })).not.toThrow();
    expect(sanitizeLogValue({ valid, invalid, error })).toEqual({
      valid: "2026-08-26T10:00:00.000Z",
      invalid: "[invalid-date]",
      error: {},
    });
  });
});

describe("log levels", () => {
  it("tags authentication debug events with the auth category", () => {
    const events: Array<{ category?: string; event: string }> = [];
    const unsubscribe = logEventBus.subscribe((event) => events.push({
      category: event.category,
      event: event.event,
    }));

    authDebugLog("auth_debug_test", { safe: true });
    unsubscribe();

    expect(events).toContainEqual({ category: "auth", event: "auth_debug_test" });
  });

  it("publishes debug, info, warn and error events for subscribers", () => {
    const levels: string[] = [];
    const unsubscribe = logEventBus.subscribe((event) => levels.push(event.level));

    logger.debug("test_debug");
    logger.info("test_info");
    logger.warn("test_warn");
    logger.error("test_error");
    unsubscribe();

    expect(levels).toEqual(["debug", "info", "warn", "error"]);
  });

  it("sanitizes metadata and messages before publishing to every subscriber", () => {
    const events: Parameters<Parameters<typeof logEventBus.subscribe>[0]>[0][] = [];
    const unsubscribe = logEventBus.subscribe((event) => events.push(event));

    logger.warn(
      "subscriber_redaction_test",
      { linkUserId: "private-user", safe: true },
      { message: "Failed for user@example.com token=private-token" },
    );
    unsubscribe();

    expect(events).toContainEqual(expect.objectContaining({
      message: "Failed for [redacted-email] token=[redacted]",
      metadata: { linkUserId: "[redacted]", safe: true },
    }));
    expect(JSON.stringify(events)).not.toContain("private-user");
    expect(JSON.stringify(events)).not.toContain("private-token");
  });

  it("renders a readable message when a caller supplies only a structured event name", () => {
    const consoleInfo = vi.spyOn(console, "info").mockImplementation(() => undefined);

    logger.info("password_reset_success", { safe: true }, { source: "auth.password-reset" });

    expect(consoleInfo).toHaveBeenCalledWith(expect.stringContaining("Password reset success"));
    expect(consoleInfo).toHaveBeenCalledWith(expect.stringContaining("event=password_reset_success"));
    expect(consoleInfo).toHaveBeenCalledWith(expect.stringContaining("clean-pay/auth.password-reset"));
    consoleInfo.mockRestore();
  });
});
