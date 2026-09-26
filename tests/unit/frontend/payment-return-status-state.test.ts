import { describe, expect, it } from "vitest";

import type { PaymentStatusViewModel } from "@/application/models/payment-status";
import {
  advancePaymentReturnPollAttempt,
  formatPaymentReturnDate,
  paymentReturnHeading,
  paymentReturnSeverity,
  paymentReturnStatusLabel,
  selectPaymentReturnStatusState,
  shouldAttemptInitialPaymentReturnRefresh,
  shouldWakePaymentReturnPolling,
} from "@/frontend/components/payment-return-status-state";

function operation(
  status: NonNullable<PaymentStatusViewModel["operation"]>["status"],
): NonNullable<PaymentStatusViewModel["operation"]> {
  return {
    operation_id: "operation-1",
    status,
    retry_after_seconds: null,
    requires_support: status === "manual_required",
    operator_action: null,
  };
}

describe("payment return status pure state", () => {
  it("preserves established headings, labels, severity and invalid-date copy", () => {
    expect(paymentReturnHeading(null)).toBe("Проверяем статус платежа");
    expect(paymentReturnHeading({
      operation: operation("processing"),
      payment: null,
      subscription: null,
    })).toBe("Платёж обрабатывается");
    expect(paymentReturnStatusLabel("completed")).toBe("Оплачен");
    expect(paymentReturnStatusLabel("provider_custom")).toBe("provider_custom");
    expect(paymentReturnSeverity("completed")).toBe("success");
    expect(paymentReturnSeverity("pending")).toBe("warning");
    expect(paymentReturnSeverity("canceled")).toBe("danger");
    expect(paymentReturnSeverity("refunded")).toBe("info");
    expect(formatPaymentReturnDate("not-a-date")).toBe("Дата не указана");
  });

  it("selects error precedence, polling identity and the bounded-stop flag", () => {
    expect(selectPaymentReturnStatusState({
      currentModel: { status: "error", message: "model error" },
      operationId: null,
      paymentId: "payment-1",
      refreshError: "refresh error",
      stoppedPollingKey: null,
    })).toEqual({
      autoPollingStopped: false,
      data: null,
      error: "refresh error",
      pollingKey: "payment-1",
    });

    const data = {
      operation: operation("processing"),
      payment: null,
      subscription: null,
    };
    expect(selectPaymentReturnStatusState({
      currentModel: { status: "ready", data },
      operationId: "fallback-operation",
      paymentId: null,
      refreshError: null,
      stoppedPollingKey: "operation-1",
    })).toEqual({
      autoPollingStopped: true,
      data,
      error: null,
      pollingKey: "operation-1",
    });
  });

  it("keeps initial lookup eligibility exact for empty and retry-ready snapshots", () => {
    const emptyData = { operation: null, payment: null, subscription: null };
    expect(shouldAttemptInitialPaymentReturnRefresh({
      data: emptyData,
      initialLookupAttempted: false,
      operationId: null,
      paymentId: "payment-1",
    })).toBe(true);
    expect(shouldAttemptInitialPaymentReturnRefresh({
      data: emptyData,
      initialLookupAttempted: true,
      operationId: null,
      paymentId: "payment-1",
    })).toBe(false);
    expect(shouldAttemptInitialPaymentReturnRefresh({
      data: {
        ...emptyData,
        operation: operation("retry_ready"),
      },
      initialLookupAttempted: false,
      operationId: "operation-1",
      paymentId: null,
    })).toBe(true);
  });

  it("models wake eligibility and the exact final poll transition", () => {
    expect(shouldWakePaymentReturnPolling("hidden", true)).toBe(false);
    expect(shouldWakePaymentReturnPolling("visible", false)).toBe(false);
    expect(shouldWakePaymentReturnPolling("visible", true)).toBe(true);
    expect(advancePaymentReturnPollAttempt(10)).toEqual({
      nextAttempt: 11,
      stopsAfterRefresh: false,
    });
    expect(advancePaymentReturnPollAttempt(11)).toEqual({
      nextAttempt: 12,
      stopsAfterRefresh: true,
    });
  });
});
