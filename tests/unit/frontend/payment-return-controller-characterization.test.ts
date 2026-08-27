/** @vitest-environment jsdom */

import { act, cleanup, renderHook } from "@testing-library/react";
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

import type { PaymentStatusPageModel } from "@/application/models/payment-status";
import { usePaymentReturnStatusController } from "@/frontend/hooks/use-payment-return-status-controller";

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

function renderController() {
  return renderHook(() => usePaymentReturnStatusController({
    model: pendingModel(),
    operationId: "operation-1",
    paymentId: null,
  }));
}

function setVisibility(value: DocumentVisibilityState) {
  Object.defineProperty(document, "visibilityState", {
    configurable: true,
    value,
  });
}

function setOnline(value: boolean) {
  Object.defineProperty(window.navigator, "onLine", {
    configurable: true,
    value,
  });
}

describe("payment return controller browser lifecycle", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    setVisibility("visible");
    setOnline(true);
    mocks.paymentPollDelayMs.mockReturnValue(10);
    mocks.refresh.mockImplementation(async () => pendingModel());
  });

  afterEach(() => {
    cleanup();
    setVisibility("visible");
    setOnline(true);
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it("resumes a discarded hidden-tab timer only after becoming visible", async () => {
    setVisibility("hidden");
    renderController();

    expect(vi.getTimerCount()).toBe(1);
    await act(async () => vi.advanceTimersByTime(10));
    expect(mocks.refresh).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);

    setVisibility("visible");
    await act(async () =>
      document.dispatchEvent(new Event("visibilitychange"))
    );
    expect(vi.getTimerCount()).toBe(1);
    await act(async () => vi.advanceTimersByTime(10));

    expect(mocks.refresh).toHaveBeenCalledOnce();
    expect(mocks.refresh).toHaveBeenCalledWith({
      operationId: "operation-1",
      paymentId: null,
    });
  });

  it("resumes a discarded offline timer only after the online event", async () => {
    setOnline(false);
    renderController();

    await act(async () => vi.advanceTimersByTime(10));
    expect(mocks.refresh).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);

    setOnline(true);
    await act(async () => window.dispatchEvent(new Event("online")));
    expect(vi.getTimerCount()).toBe(1);
    await act(async () => vi.advanceTimersByTime(10));

    expect(mocks.refresh).toHaveBeenCalledOnce();
    expect(mocks.refresh).toHaveBeenCalledWith({
      operationId: "operation-1",
      paymentId: null,
    });
  });

  it("uses exactly the bounded budget and cleans timers and listeners", async () => {
    const removeDocumentListener = vi.spyOn(document, "removeEventListener");
    const removeWindowListener = vi.spyOn(window, "removeEventListener");
    const view = renderController();

    for (let attempt = 0; attempt < 12; attempt += 1) {
      await act(async () => vi.advanceTimersByTime(10));
    }

    expect(mocks.refresh).toHaveBeenCalledTimes(12);
    expect(mocks.refresh.mock.calls).toEqual(Array.from({ length: 12 }, () => [{
      operationId: "operation-1",
      paymentId: null,
    }]));
    expect(view.result.current.autoPollingStopped).toBe(true);
    expect(vi.getTimerCount()).toBe(0);

    view.unmount();
    expect(removeDocumentListener).toHaveBeenCalledWith(
      "visibilitychange",
      expect.any(Function),
    );
    expect(removeWindowListener).toHaveBeenCalledWith(
      "online",
      expect.any(Function),
    );
    window.dispatchEvent(new Event("online"));
    document.dispatchEvent(new Event("visibilitychange"));
    await act(async () => vi.runAllTimersAsync());
    expect(mocks.refresh).toHaveBeenCalledTimes(12);
  });

  it("ignores a stale automatic completion after the newer manual result", async () => {
    let resolveAutomatic!: (model: PaymentStatusPageModel) => void;
    const automatic = new Promise<PaymentStatusPageModel>((resolve) => {
      resolveAutomatic = resolve;
    });
    mocks.refresh
      .mockReset()
      .mockReturnValueOnce(automatic)
      .mockResolvedValueOnce(terminalModel());
    const view = renderController();

    await act(async () => vi.advanceTimersByTime(10));
    await act(async () => {
      view.result.current.refreshManually();
      await Promise.resolve();
    });

    expect(mocks.refresh).toHaveBeenCalledTimes(2);
    expect(mocks.refresh.mock.calls).toEqual([
      [{ operationId: "operation-1", paymentId: null }],
      [{ operationId: "operation-1", paymentId: null }],
    ]);
    expect(mocks.refresh.mock.invocationCallOrder[0])
      .toBeLessThan(mocks.refresh.mock.invocationCallOrder[1]!);
    expect(view.result.current.data?.operation?.status).toBe("manual_required");

    await act(async () => {
      resolveAutomatic(pendingModel());
      await automatic;
    });
    expect(view.result.current.data?.operation?.status).toBe("manual_required");
    expect(vi.getTimerCount()).toBe(0);
  });

  it("clears the scheduled timer before issuing a manual refresh", async () => {
    const clearTimeout = vi.spyOn(window, "clearTimeout");
    mocks.refresh.mockReset().mockResolvedValue(terminalModel());
    const view = renderController();
    expect(vi.getTimerCount()).toBe(1);

    await act(async () => {
      view.result.current.refreshManually();
      await Promise.resolve();
    });

    expect(mocks.refresh).toHaveBeenCalledOnce();
    expect(mocks.refresh).toHaveBeenCalledWith({
      operationId: "operation-1",
      paymentId: null,
    });
    expect(clearTimeout.mock.invocationCallOrder[0])
      .toBeLessThan(mocks.refresh.mock.invocationCallOrder[0]!);
    expect(vi.getTimerCount()).toBe(0);
  });
});
