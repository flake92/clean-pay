/** @vitest-environment jsdom */

import { act, createElement } from "react";
import { cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  paymentPollDelayMs: vi.fn(() => 10),
  refresh: vi.fn(),
}));

vi.mock("@/app/actions/payment-status", () => ({
  refreshPaymentStatusAction: mocks.refresh,
}));
vi.mock("@/frontend/lib/payment-return", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/frontend/lib/payment-return")>(),
  paymentPollDelayMs: mocks.paymentPollDelayMs,
}));
vi.mock("primereact/message", () => ({ Message: () => null }));
vi.mock("primereact/tag", () => ({ Tag: () => null }));
vi.mock("primereact/button", () => ({ Button: () => null }));
vi.mock("@/frontend/components/prime/link-button", () => ({ LinkButton: () => null }));

import { PaymentReturnStatus } from "@/frontend/components/payment-return-status";
import type { PaymentStatusPageModel } from "@/application/models/payment-status";

function pendingModel(): PaymentStatusPageModel {
  return {
    status: "ready",
    data: {
      operation: {
        operation_id: "operation-1",
        status: "processing",
        retry_after_seconds: 5,
        requires_support: false,
        operator_action: null,
      },
      payment: null,
      subscription: null,
    },
  };
}

function terminalModel(): PaymentStatusPageModel {
  return {
    status: "ready",
    data: {
      operation: {
        operation_id: "operation-1",
        status: "manual_required",
        retry_after_seconds: null,
        requires_support: true,
        operator_action: "review_payment_operation",
      },
      payment: null,
      subscription: null,
    },
  };
}

function retryReadyModel(): PaymentStatusPageModel {
  return {
    status: "ready",
    data: {
      operation: {
        operation_id: "operation-1",
        status: "retry_ready",
        retry_after_seconds: null,
        requires_support: false,
        operator_action: null,
      },
      payment: null,
      subscription: null,
    },
  };
}

describe("payment return polling", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    mocks.paymentPollDelayMs.mockReturnValue(10);
    mocks.refresh
      .mockResolvedValueOnce(pendingModel())
      .mockResolvedValueOnce(terminalModel());
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  it("increments the backoff attempt and stops polling at a terminal state", async () => {
    render(createElement(PaymentReturnStatus, {
      kind: "pending",
      model: pendingModel(),
      operationId: "operation-1",
      paymentId: null,
    }));

    expect(mocks.paymentPollDelayMs).toHaveBeenLastCalledWith(0, 5);
    await act(async () => vi.advanceTimersByTime(10));
    expect(mocks.refresh).toHaveBeenCalledWith({
      operationId: "operation-1",
      paymentId: null,
    });
    expect(mocks.paymentPollDelayMs).toHaveBeenLastCalledWith(1, 5);

    await act(async () => vi.advanceTimersByTime(10));
    expect(mocks.refresh).toHaveBeenCalledTimes(2);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("requests one command-side refresh when the local snapshot is still empty", async () => {
    mocks.refresh.mockReset();
    mocks.refresh.mockResolvedValue(terminalModel());

    render(createElement(PaymentReturnStatus, {
      kind: "pending",
      model: {
        status: "ready",
        data: { operation: null, payment: null, subscription: null },
      },
      operationId: null,
      paymentId: "11111111-1111-4111-8111-111111111111",
    }));
    await act(async () => Promise.resolve());

    expect(mocks.refresh).toHaveBeenCalledOnce();
    expect(mocks.refresh).toHaveBeenCalledWith({
      operationId: null,
      paymentId: "11111111-1111-4111-8111-111111111111",
    });
  });

  it("refreshes a stored retry-ready operation once before treating it as terminal", async () => {
    mocks.refresh.mockReset();
    mocks.refresh.mockResolvedValue(terminalModel());

    render(createElement(PaymentReturnStatus, {
      kind: "pending",
      model: retryReadyModel(),
      operationId: "operation-1",
      paymentId: null,
    }));
    await act(async () => Promise.resolve());

    expect(mocks.refresh).toHaveBeenCalledOnce();
    expect(mocks.refresh).toHaveBeenCalledWith({
      operationId: "operation-1",
      paymentId: null,
    });
    expect(vi.getTimerCount()).toBe(0);
  });
});
