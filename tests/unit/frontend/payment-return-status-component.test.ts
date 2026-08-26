/** @vitest-environment jsdom */

import { act, createElement } from "react";
import { cleanup, fireEvent, render } from "@testing-library/react";
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
vi.mock("primereact/message", () => ({
  Message: ({ text }: { text?: string }) => createElement("div", { role: "alert" }, text),
}));
vi.mock("primereact/tag", () => ({ Tag: () => null }));
vi.mock("primereact/button", () => ({
  Button: ({ label, onClick }: { label?: string; onClick?: () => void }) =>
    createElement("button", { onClick, type: "button" }, label),
}));
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
    Object.defineProperty(window.navigator, "onLine", { configurable: true, value: true });
    vi.useRealTimers();
  });

  it("uses a subordinate heading below the page title", () => {
    const view = render(createElement(PaymentReturnStatus, {
      kind: "pending",
      model: pendingModel(),
      operationId: "operation-1",
      paymentId: null,
    }));

    expect(view.getByRole("heading", { level: 2 }).textContent)
      .toBe("Платёж обрабатывается");
    expect(view.queryByRole("heading", { level: 1 })).toBeNull();
  });

  it("renders a safe fallback instead of crashing on an invalid provider date", () => {
    const view = render(createElement(PaymentReturnStatus, {
      kind: "success",
      model: {
        status: "ready",
        data: {
          operation: null,
          payment: {
            gateway_type: "CARD",
            payment_id: "payment-1",
            plan_name: null,
            purchase_type: "NEW",
            status: "completed",
            final_amount: "100.00",
            currency: "RUB",
            created_at: "not-a-date",
          },
          subscription: null,
        },
      },
      operationId: null,
      paymentId: "payment-1",
    }));

    expect(view.getByText("Дата не указана")).toBeTruthy();
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

  it("stops automatic polling after the bounded attempt budget", async () => {
    mocks.refresh.mockReset();
    mocks.refresh.mockImplementation(async () => pendingModel());

    const view = render(createElement(PaymentReturnStatus, {
      kind: "pending",
      model: pendingModel(),
      operationId: "operation-1",
      paymentId: null,
    }));

    for (let attempt = 0; attempt < 12; attempt += 1) {
      await act(async () => vi.advanceTimersByTime(10));
    }

    expect(mocks.refresh).toHaveBeenCalledTimes(12);
    expect(vi.getTimerCount()).toBe(0);
    expect(view.getByText(/Автоматическая проверка приостановлена/)).toBeTruthy();

    await act(async () => {
      fireEvent.click(view.getByRole("button", { name: "Обновить статус" }));
      await Promise.resolve();
    });
    expect(mocks.refresh).toHaveBeenCalledTimes(13);
    expect(view.queryByText(/Автоматическая проверка приостановлена/)).toBeNull();
    expect(vi.getTimerCount()).toBe(1);
  });

  it("pauses network polling while offline and resumes after the online event", async () => {
    Object.defineProperty(window.navigator, "onLine", { configurable: true, value: false });
    mocks.refresh.mockReset();
    mocks.refresh.mockImplementation(async () => pendingModel());

    render(createElement(PaymentReturnStatus, {
      kind: "pending",
      model: pendingModel(),
      operationId: "operation-1",
      paymentId: null,
    }));

    await act(async () => vi.advanceTimersByTime(10));
    expect(mocks.refresh).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);

    Object.defineProperty(window.navigator, "onLine", { configurable: true, value: true });
    await act(async () => window.dispatchEvent(new Event("online")));
    expect(vi.getTimerCount()).toBe(1);
    await act(async () => vi.advanceTimersByTime(10));
    expect(mocks.refresh).toHaveBeenCalledOnce();
  });

  it("keeps a transport failure local and stops automatic retries", async () => {
    mocks.refresh.mockReset();
    mocks.refresh.mockRejectedValue(new Error("network secret"));

    const view = render(createElement(PaymentReturnStatus, {
      kind: "pending",
      model: pendingModel(),
      operationId: "operation-1",
      paymentId: null,
    }));

    await act(async () => vi.advanceTimersByTime(10));
    const transportAlert = view.getByText(/Проверьте соединение/);
    expect(transportAlert.textContent).not.toContain("network secret");
    expect(vi.getTimerCount()).toBe(0);
  });

  it("ignores an older automatic response after a manual refresh completes", async () => {
    mocks.refresh.mockReset();
    let resolveAutomatic!: (model: PaymentStatusPageModel) => void;
    const automaticResponse = new Promise<PaymentStatusPageModel>((resolve) => {
      resolveAutomatic = resolve;
    });
    mocks.refresh
      .mockReturnValueOnce(automaticResponse)
      .mockResolvedValueOnce(terminalModel());

    const view = render(createElement(PaymentReturnStatus, {
      kind: "pending",
      model: pendingModel(),
      operationId: "operation-1",
      paymentId: null,
    }));

    await act(async () => vi.advanceTimersByTime(10));
    await act(async () => {
      fireEvent.click(view.getByRole("button", { name: "Обновить статус" }));
      await Promise.resolve();
    });
    expect(mocks.refresh).toHaveBeenCalledTimes(2);
    expect(view.getByRole("heading").textContent).toBe("Статус платежа требует проверки");

    await act(async () => {
      resolveAutomatic(pendingModel());
      await automaticResponse;
    });
    expect(view.getByRole("heading").textContent).toBe("Статус платежа требует проверки");
    expect(vi.getTimerCount()).toBe(0);
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
