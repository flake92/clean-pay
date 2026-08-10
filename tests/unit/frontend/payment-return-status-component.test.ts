/** @vitest-environment jsdom */

import { act, createElement } from "react";
import { cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  paymentPollDelayMs: vi.fn(() => 10),
  refresh: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: mocks.refresh }),
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

describe("payment return polling", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    mocks.paymentPollDelayMs.mockReturnValue(10);
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  it("increments the backoff attempt after every completed timer and resets at a terminal state", async () => {
    const view = render(createElement(PaymentReturnStatus, {
      kind: "pending",
      model: pendingModel(),
    }));

    expect(mocks.paymentPollDelayMs).toHaveBeenLastCalledWith(0, 5);
    await act(async () => vi.advanceTimersByTime(10));
    expect(mocks.refresh).toHaveBeenCalledOnce();

    view.rerender(createElement(PaymentReturnStatus, {
      kind: "pending",
      model: pendingModel(),
    }));
    expect(mocks.paymentPollDelayMs).toHaveBeenLastCalledWith(1, 5);

    view.rerender(createElement(PaymentReturnStatus, {
      kind: "pending",
      model: terminalModel(),
    }));
    view.rerender(createElement(PaymentReturnStatus, {
      kind: "pending",
      model: pendingModel(),
    }));
    expect(mocks.paymentPollDelayMs).toHaveBeenLastCalledWith(0, 5);
  });
});
