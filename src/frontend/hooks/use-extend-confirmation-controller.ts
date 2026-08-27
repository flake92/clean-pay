"use client";

import { useEffect, useRef, useState } from "react";

import { executePaymentAction } from "@/app/actions/payments";
import type { CheckoutViewModel } from "@/application/models/checkout";
import {
  buildExtendPriceOptions,
  extensionDestination,
  initialExtendSelection,
  parseExtendSelection,
  selectExtendConfirmationView,
} from "@/frontend/components/extend-confirmation-presentation";
import { navigateTo, replaceWith } from "@/frontend/lib/browser-navigation";
import {
  clearPaymentIdempotencyKey,
  getOrCreatePaymentIdempotencyKey,
} from "@/frontend/lib/payment-idempotency";
import { findRenewPlan } from "@/frontend/lib/subscription-offers";
import {
  accountLinkPath,
  emailVerificationPath,
} from "@/shared/auth/account-setup-flow";
import { confirmedPaymentOffer } from "@/shared/domain/payment-offer";
import type { DurationGatewayPrice } from "@/shared/domain/subscriptions";

export function useExtendConfirmationController({
  model,
  pendingOperationDestination,
  pendingPaymentDestination,
  requestedDuration,
  requestedGateway,
}: {
  model: CheckoutViewModel;
  pendingOperationDestination: (operationId: string) => string;
  pendingPaymentDestination: (paymentId: string) => string;
  requestedDuration: string | null;
  requestedGateway: string | null;
}) {
  const state = model;
  const view = selectExtendConfirmationView(state);
  const initialPlan = state.status === "ready"
    ? findRenewPlan(state.offers)
    : undefined;
  const [selection, setSelection] = useState(() =>
    initialExtendSelection(initialPlan, requestedDuration, requestedGateway)
  );
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const submittingRef = useRef(false);
  const requestedExtendDestination = extensionDestination(
    requestedDuration,
    requestedGateway,
  );
  const verifyEmailRequired = view.kind === "verify-email";

  useEffect(() => {
    if (verifyEmailRequired) {
      replaceWith(emailVerificationPath(requestedExtendDestination));
    }
  }, [requestedExtendDestination, verifyEmailRequired]);

  const plan = view.kind === "ready" ? view.plan : undefined;
  const [selectedDays, selectedGateway] = parseExtendSelection(selection);
  const selectedDuration = plan?.durations.find(
    (duration) => String(duration.days) === selectedDays,
  );
  const selectedPrice = selectedDuration?.prices.find(
    (price): price is DurationGatewayPrice =>
      price.gateway_type === selectedGateway,
  );
  const priceOptions = buildExtendPriceOptions(plan);
  const selectedExtendDestination = extensionDestination(
    selectedDuration?.days,
    selectedPrice?.gateway_type,
  );

  function finishSubmitting() {
    submittingRef.current = false;
    setSubmitting(false);
  }

  async function extendSubscription() {
    if (
      !plan ||
      !selectedDuration ||
      !selectedPrice ||
      submittingRef.current
    ) {
      return;
    }

    submittingRef.current = true;
    setSubmitting(true);
    setSubmitError(null);
    const payload = {
      duration_days: selectedDuration.days,
      gateway_type: selectedPrice.gateway_type,
      ...confirmedPaymentOffer(plan, selectedDuration.days, selectedPrice),
    };

    let idempotencyKey: string;

    try {
      idempotencyKey = getOrCreatePaymentIdempotencyKey("extend", payload);
    } catch {
      finishSubmitting();
      setSubmitError(
        "Браузер не смог безопасно подготовить продление. Обновите страницу или используйте другой браузер.",
      );
      return;
    }

    let paymentConfirmed = false;

    try {
      const result = await executePaymentAction({
        kind: "extend",
        request: payload,
        idempotencyKey,
      });
      if (!result.ok) {
        if (
          result.code === "EMAIL_REQUIRED" ||
          result.code === "EMAIL_NOT_VERIFIED"
        ) {
          replaceWith(accountLinkPath(selectedExtendDestination));
          return;
        }
        if (!result.retainIdempotencyKey) {
          clearPaymentIdempotencyKey("extend", payload, idempotencyKey);
        }
        setSubmitError(result.message);
        return;
      }
      if (result.status === "pending") {
        paymentConfirmed = true;
        navigateTo(pendingOperationDestination(result.operationId));
        return;
      }
      if (result.status === "manual-review") {
        setSubmitError(
          `Статус продления требует ручной проверки. Сообщите поддержке номер операции ${result.operationId}.`,
        );
        return;
      }

      clearPaymentIdempotencyKey("extend", payload, idempotencyKey);
      paymentConfirmed = true;
      if (result.payment.is_free) {
        navigateTo("/cabinet");
        return;
      }

      if (result.payment.payment_url) {
        navigateTo(result.payment.payment_url);
        return;
      }

      navigateTo(pendingPaymentDestination(result.payment.payment_id));
    } catch {
      setSubmitError(
        "Не удалось определить результат продления. Повторите попытку — будет использован тот же запрос и новая оплата не будет создана.",
      );
    } finally {
      if (!paymentConfirmed) {
        finishSubmitting();
      }
    }
  }

  return {
    extendSubscription,
    priceOptions,
    requestedExtendDestination,
    selectedDuration,
    selectedExtendDestination,
    selectedPrice,
    selection,
    setSelection,
    submitError,
    submitting,
    view,
  };
}
