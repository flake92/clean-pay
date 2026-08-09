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
      hasTelegramId: true,
      requestId: "trace-safe-to-retain",
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
      hasTelegramId: true,
      requestId: "trace-safe-to-retain",
    });
    expect(JSON.stringify(sanitized)).not.toContain("123456789");
    expect(JSON.stringify(sanitized)).not.toContain("user@example.com");
  });

  it("redacts credentials and email addresses embedded in unstructured errors", () => {
    const sanitized = sanitizeLogValue({
      error: "SMTP failed for user@example.com; password=hunter2 token='abc.def' Authorization: Bearer bearer-secret",
    });

    expect(JSON.stringify(sanitized)).not.toContain("user@example.com");
    expect(JSON.stringify(sanitized)).not.toContain("hunter2");
    expect(JSON.stringify(sanitized)).not.toContain("abc.def");
    expect(JSON.stringify(sanitized)).not.toContain("bearer-secret");
    expect(sanitized).toEqual({
      error: expect.stringContaining("SMTP failed"),
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

  it("renders a readable message when a caller supplies only a structured event name", () => {
    const consoleInfo = vi.spyOn(console, "info").mockImplementation(() => undefined);

    logger.info("password_reset_success", { safe: true }, { source: "auth.password-reset" });

    expect(consoleInfo).toHaveBeenCalledWith(expect.stringContaining("Password reset success"));
    expect(consoleInfo).toHaveBeenCalledWith(expect.stringContaining("event=password_reset_success"));
    expect(consoleInfo).toHaveBeenCalledWith(expect.stringContaining("clean-pay/auth.password-reset"));
    consoleInfo.mockRestore();
  });
});
