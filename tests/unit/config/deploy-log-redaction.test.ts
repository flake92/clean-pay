import { describe, expect, it, vi } from "vitest";

import {
  deployLog,
  sanitizeDeployLogMessage,
} from "../../../deploy/prod/deploy-log.mjs";

describe("deployment logger identifier redaction", () => {
  it("removes raw operation identifiers from message and metadata fields", () => {
    const sentinel = "op_sensitive_marker";
    const output = vi.spyOn(console, "info").mockImplementation(() => undefined);

    deployLog(
      "info",
      "fixture",
      `Completed manual_operation_ids=${sentinel}.`,
      {
        manual_operation_ids: sentinel,
        manual_operation_handles: ["7cb9ef57a1ad85ab"],
      },
    );

    const line = String(output.mock.calls[0]?.[0]);
    expect(line).not.toContain(sentinel);
    expect(line).toContain("manual_operation_ids=[redacted]");
    expect(line).toContain("manual_operation_handles");
    expect(line).toContain("7cb9ef57a1ad85ab");
    output.mockRestore();
  });

  it("does not alter ordinary safe deployment messages", () => {
    expect(sanitizeDeployLogMessage("Payment reconciliation batch completed."))
      .toBe("Payment reconciliation batch completed.");
  });

  it("redacts nested identifiers without removing approved support handles", () => {
    const sentinel = "nested_sensitive_operation_marker";
    const circular: Record<string, unknown> = {};
    circular.self = circular;
    const output = vi.spyOn(console, "info").mockImplementation(() => undefined);

    deployLog("info", "nested_fixture", "Nested fixture completed.", {
      result: {
        operationId: sentinel,
        rows: [{ payment_ids: [sentinel] }],
        operation_handle: "7cb9ef57a1ad85ab",
        circular,
      },
    });

    const line = String(output.mock.calls[0]?.[0]);
    expect(line).not.toContain(sentinel);
    expect(line).toContain('"operationId":"[redacted]"');
    expect(line).toContain('"payment_ids":"[redacted]"');
    expect(line).toContain('"operation_handle":"7cb9ef57a1ad85ab"');
    expect(line).toContain('"self":"[circular]"');
    output.mockRestore();
  });

  it("redacts prefixed camelCase identifiers used by reconciliation payloads", () => {
    const operationSentinel = "op_sensitive_marker";
    const paymentSentinel = "pay_sensitive_marker";
    const output = vi.spyOn(console, "info").mockImplementation(() => undefined);

    deployLog(
      "info",
      "camel_case_fixture",
      `manualRequiredOperationIds=${operationSentinel} providerPaymentId=${paymentSentinel}`,
      {
        manualRequiredOperationIds: [operationSentinel],
        providerPaymentId: paymentSentinel,
        manualRequiredOperationHandles: ["7cb9ef57a1ad85ab"],
      },
    );

    const line = String(output.mock.calls[0]?.[0]);
    expect(line).not.toContain(operationSentinel);
    expect(line).not.toContain(paymentSentinel);
    expect(line).toContain("manualRequiredOperationIds=[redacted]");
    expect(line).toContain("providerPaymentId=[redacted]");
    expect(line).toContain("7cb9ef57a1ad85ab");
    output.mockRestore();
  });
});
