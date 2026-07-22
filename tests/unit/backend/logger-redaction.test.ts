import { describe, expect, it } from "vitest";

import { logEventBus, logger, sanitizeLogValue } from "@/backend/observability/logger";

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
});

describe("log levels", () => {
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
});
