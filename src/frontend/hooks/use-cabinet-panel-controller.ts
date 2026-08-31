import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, type FormEvent } from "react";

import { logoutAction } from "@/app/actions/session";
import {
  activatePromocodeAction,
  deleteAllDevicesAction,
  deleteDeviceAction,
  reissueSubscriptionAction,
} from "@/app/actions/cabinet";
import type { PaymentHistorySnapshotStatus } from "@/application/models/cabinet";
import type { CurrentSubscription } from "@/frontend/components/cabinet-presentation";
import {
  beginCabinetPendingAction,
  canScheduleCabinetPaymentHistoryRefresh,
  finishCabinetPendingAction,
  normalizeCabinetPromocode,
  shouldRefreshCabinetAfterAction,
} from "@/frontend/components/cabinet-panel-transitions";
import { resetChatwootSession } from "@/frontend/lib/chatwoot";

const PAYMENT_HISTORY_REFRESH_INTERVAL_MS = 10_000;
const REISSUE_SUBSCRIPTION_CONFIRMATION = [
  "Перевыпуск подписки отключит все текущие устройства.",
  "",
  "После перевыпуска старая ссылка перестанет работать, и все устройства придётся заново переподключить.",
  "",
  "Вам потребуется:",
  "• Удалить старую подписку из приложения",
  "• Добавить новую ссылку из раздела «Подключиться»",
  "",
  "Вы уверены, что хотите перевыпустить подписку?",
].join("\n");

export function useCabinetPanelController({
  paymentHistoryStatus,
  subscription,
}: {
  paymentHistoryStatus: PaymentHistorySnapshotStatus;
  subscription: CurrentSubscription | null;
}) {
  const router = useRouter();
  const [copyStatus, setCopyStatus] = useState<string | null>(null);
  const [actionMessage, setActionMessage] = useState<string | null>(null);
  const [promocodeMessage, setPromocodeMessage] = useState<string | null>(null);
  const [pendingAction, setPendingAction] = useState<string | null>(null);
  const pendingActionRef = useRef<string | null>(null);
  const paymentHistoryRefreshAttempts = useRef(0);
  const [promocode, setPromocode] = useState("");

  useEffect(() => {
    if (paymentHistoryStatus !== "refreshing") {
      paymentHistoryRefreshAttempts.current = 0;
      return;
    }

    let timeoutId: ReturnType<typeof setTimeout> | null = null;
    const scheduleRefresh = () => {
      if (
        !canScheduleCabinetPaymentHistoryRefresh(
          paymentHistoryRefreshAttempts.current,
        )
      ) {
        return;
      }

      timeoutId = setTimeout(() => {
        paymentHistoryRefreshAttempts.current += 1;
        router.refresh();
        scheduleRefresh();
      }, PAYMENT_HISTORY_REFRESH_INTERVAL_MS);
    };

    scheduleRefresh();

    return () => {
      if (timeoutId !== null) clearTimeout(timeoutId);
    };
  }, [paymentHistoryStatus, router]);

  function beginPendingAction(action: string) {
    const transition = beginCabinetPendingAction(
      pendingActionRef.current,
      action,
    );
    if (!transition.accepted) {
      return false;
    }

    pendingActionRef.current = transition.pendingAction;
    setPendingAction(transition.pendingAction);
    return true;
  }

  function finishPendingAction(action: string) {
    const nextAction = finishCabinetPendingAction(
      pendingActionRef.current,
      action,
    );
    if (nextAction === pendingActionRef.current) {
      return;
    }

    pendingActionRef.current = nextAction;
    setPendingAction(nextAction);
  }

  async function copySubscriptionUrl() {
    if (!subscription?.url) {
      return;
    }

    try {
      await navigator.clipboard.writeText(subscription.url);
      setCopyStatus("Ссылка скопирована");
    } catch {
      setCopyStatus("Не удалось скопировать");
    }
  }

  async function deleteDevice(hwid: string) {
    if (pendingActionRef.current) {
      return;
    }

    const confirmed = window.confirm("Удалить это устройство из подписки?");

    if (!confirmed) {
      return;
    }

    const action = `delete-device-${hwid}`;
    if (!beginPendingAction(action)) {
      return;
    }
    setActionMessage(null);

    try {
      const result = await deleteDeviceAction(hwid);
      setActionMessage(result.message);
      if (shouldRefreshCabinetAfterAction(result.status)) router.refresh();
    } catch {
      setActionMessage("Сеть недоступна. Не удалось удалить устройство.");
    } finally {
      finishPendingAction(action);
    }
  }

  async function deleteAllDevices() {
    if (pendingActionRef.current) {
      return;
    }

    const confirmed = window.confirm("Удалить все устройства из подписки?");

    if (!confirmed) {
      return;
    }

    const action = "delete-all-devices";
    if (!beginPendingAction(action)) {
      return;
    }
    setActionMessage(null);

    try {
      const result = await deleteAllDevicesAction();
      setActionMessage(result.message);
      if (shouldRefreshCabinetAfterAction(result.status)) router.refresh();
    } catch {
      setActionMessage("Сеть недоступна. Не удалось удалить устройства.");
    } finally {
      finishPendingAction(action);
    }
  }

  async function reissueSubscription() {
    if (pendingActionRef.current) {
      return;
    }

    const confirmed = window.confirm(REISSUE_SUBSCRIPTION_CONFIRMATION);

    if (!confirmed) {
      return;
    }

    const action = "reissue";
    if (!beginPendingAction(action)) {
      return;
    }
    setActionMessage(null);

    try {
      const result = await reissueSubscriptionAction();
      setActionMessage(result.message);
      if (shouldRefreshCabinetAfterAction(result.status)) router.refresh();
    } catch {
      setActionMessage("Сеть недоступна. Не удалось перевыпустить подписку.");
    } finally {
      finishPendingAction(action);
    }
  }

  async function activatePromocode(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (pendingActionRef.current) {
      return;
    }

    const code = normalizeCabinetPromocode(promocode);

    if (!code) {
      setPromocodeMessage("Введите промокод.");
      return;
    }

    const action = "promocode";
    if (!beginPendingAction(action)) {
      return;
    }
    setPromocodeMessage(null);

    try {
      const result = await activatePromocodeAction(code);
      setPromocodeMessage(result.message);
      if (shouldRefreshCabinetAfterAction(result.status)) {
        setPromocode("");
        router.refresh();
      }
    } catch {
      setPromocodeMessage("Сеть недоступна. Не удалось активировать промокод.");
    } finally {
      finishPendingAction(action);
    }
  }

  async function logout() {
    resetChatwootSession();
    await logoutAction();
  }

  return {
    actionMessage,
    activatePromocode,
    copyStatus,
    copySubscriptionUrl,
    deleteAllDevices,
    deleteDevice,
    logout,
    pendingAction,
    promocode,
    promocodeMessage,
    reissueSubscription,
    setPromocode,
  };
}
