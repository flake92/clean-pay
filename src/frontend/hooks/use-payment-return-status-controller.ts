"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  useTransition,
} from "react";

import { refreshPaymentStatusAction } from "@/app/actions/payment-status";
import type { PaymentStatusPageModel } from "@/application/models/payment-status";
import {
  advancePaymentReturnPollAttempt,
  selectPaymentReturnStatusState,
  shouldAttemptInitialPaymentReturnRefresh,
  shouldWakePaymentReturnPolling,
} from "@/frontend/components/payment-return-status-state";
import {
  canAutoPollPaymentReturn,
  paymentPollDelayMs,
  shouldPollPaymentReturn,
} from "@/frontend/lib/payment-return";

export function usePaymentReturnStatusController({
  model,
  operationId,
  paymentId,
}: {
  model: PaymentStatusPageModel;
  operationId: string | null;
  paymentId: string | null;
}) {
  const [loading, startRefresh] = useTransition();
  const [currentModel, setCurrentModel] = useState(model);
  const [stoppedPollingKey, setStoppedPollingKey] = useState<string | null>(null);
  const [refreshError, setRefreshError] = useState<string | null>(null);
  const [pollingWakeSignal, setPollingWakeSignal] = useState(0);
  const initialLookupAttemptedRef = useRef(false);
  const pollAttemptRef = useRef(0);
  const pollTimerRef = useRef<number | null>(null);
  const refreshRequestRef = useRef(0);
  const {
    autoPollingStopped,
    data,
    error,
    pollingKey,
  } = selectPaymentReturnStatusState({
    currentModel,
    operationId,
    paymentId,
    refreshError,
    stoppedPollingKey,
  });

  const refreshStatus = useCallback(() => {
    const requestId = refreshRequestRef.current + 1;
    refreshRequestRef.current = requestId;
    startRefresh(async () => {
      try {
        const refreshed = await refreshPaymentStatusAction({
          operationId,
          paymentId,
        });
        if (refreshRequestRef.current !== requestId) return;
        setCurrentModel(refreshed);
        setRefreshError(null);
      } catch {
        if (refreshRequestRef.current !== requestId) return;
        setRefreshError(
          "Не удалось обновить статус. Проверьте соединение и повторите вручную.",
        );
      }
    });
  }, [operationId, paymentId]);

  const refreshManually = useCallback(() => {
    if (pollTimerRef.current !== null) {
      window.clearTimeout(pollTimerRef.current);
      pollTimerRef.current = null;
    }
    pollAttemptRef.current = 0;
    setStoppedPollingKey(null);
    setRefreshError(null);
    refreshStatus();
  }, [refreshStatus]);

  useEffect(() => {
    const wakePolling = () => {
      if (shouldWakePaymentReturnPolling(
        document.visibilityState,
        navigator.onLine,
      )) {
        setPollingWakeSignal((value) => value + 1);
      }
    };

    document.addEventListener("visibilitychange", wakePolling);
    window.addEventListener("online", wakePolling);
    return () => {
      document.removeEventListener("visibilitychange", wakePolling);
      window.removeEventListener("online", wakePolling);
    };
  }, []);

  useEffect(() => {
    if (!shouldAttemptInitialPaymentReturnRefresh({
      data,
      initialLookupAttempted: initialLookupAttemptedRef.current,
      operationId,
      paymentId,
    })) {
      return;
    }

    initialLookupAttemptedRef.current = true;
    refreshStatus();
  }, [data, operationId, paymentId, refreshStatus]);

  useEffect(() => {
    if (!data || !shouldPollPaymentReturn(data)) {
      pollAttemptRef.current = 0;
      return;
    }

    if (refreshError) return;

    const attempt = pollAttemptRef.current;
    if (!canAutoPollPaymentReturn(attempt)) {
      return;
    }

    const timer = window.setTimeout(() => {
      pollTimerRef.current = null;
      if (!shouldWakePaymentReturnPolling(
        document.visibilityState,
        navigator.onLine,
      )) {
        return;
      }

      const { nextAttempt, stopsAfterRefresh } =
        advancePaymentReturnPollAttempt(attempt);
      pollAttemptRef.current = nextAttempt;
      if (stopsAfterRefresh) {
        setStoppedPollingKey(pollingKey);
      }
      refreshStatus();
    }, paymentPollDelayMs(attempt, data.operation?.retry_after_seconds));
    pollTimerRef.current = timer;

    return () => {
      window.clearTimeout(timer);
      if (pollTimerRef.current === timer) pollTimerRef.current = null;
    };
  }, [data, pollingKey, pollingWakeSignal, refreshError, refreshStatus]);

  return {
    autoPollingStopped,
    data,
    error,
    loading,
    refreshManually,
  };
}
