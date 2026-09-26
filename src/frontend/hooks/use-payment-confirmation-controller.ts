"use client";

import { useEffect, useMemo, useRef, useState } from "react";

import { executePaymentAction } from "@/app/actions/payments";
import type { CheckoutViewModel } from "@/application/models/checkout";
import { selectPaymentConfirmationView } from "@/frontend/components/payment-confirmation-presentation";
import { navigateTo, replaceWith } from "@/frontend/lib/browser-navigation";
import {
  clearPaymentIdempotencyKey,
  getOrCreatePaymentIdempotencyKey,
} from "@/frontend/lib/payment-idempotency";
import {
  accountLinkPath,
  emailVerificationPath,
} from "@/shared/auth/account-setup-flow";
import { confirmedPaymentOffer } from "@/shared/domain/payment-offer";

export function usePaymentConfirmationController({
  durationDays,
  gatewayType,
  model,
  pendingOperationDestination,
  pendingPaymentDestination,
  paymentRedirectTo,
  planCode,
}: {
  durationDays: string | null;
  gatewayType: string | null;
  model: CheckoutViewModel;
  pendingOperationDestination: (operationId: string) => string;
  pendingPaymentDestination: (paymentId: string) => string;
  paymentRedirectTo: string;
  planCode: string | null;
}) {
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const submittingRef = useRef(false);
  const view = useMemo(
    () => selectPaymentConfirmationView(
      model,
      planCode,
      durationDays,
      gatewayType,
    ),
    [durationDays, gatewayType, model, planCode],
  );
  const selection = view.kind === "ready" ? view.selection : null;
  const verifyEmailRequired = view.kind === "verify-email";

  useEffect(() => {
    if (verifyEmailRequired) {
      replaceWith(emailVerificationPath(paymentRedirectTo));
    }
  }, [paymentRedirectTo, verifyEmailRequired]);

  function finishSubmitting() {
    submittingRef.current = false;
    setSubmitting(false);
  }

  async function createPayment() {
    if (!selection || submittingRef.current) {
      return;
    }

    submittingRef.current = true;
    setSubmitting(true);
    setSubmitError(null);
    const payload = {
      plan_code: selection.plan.public_code,
      duration_days: selection.duration.days,
      gateway_type: selection.price.gateway_type,
      ...confirmedPaymentOffer(
        selection.plan,
        selection.duration.days,
        selection.price,
      ),
    };

    let idempotencyKey: string;

    try {
      idempotencyKey = getOrCreatePaymentIdempotencyKey("purchase", payload);
    } catch {
      finishSubmitting();
      setSubmitError(
        "Браузер не смог безопасно подготовить оплату. Обновите страницу или используйте другой браузер.",
      );
      return;
    }

    let paymentConfirmed = false;

    try {
      const result = await executePaymentAction({
        kind: "purchase",
        request: payload,
        idempotencyKey,
      });
      if (!result.ok) {
        if (
          result.code === "EMAIL_REQUIRED"
          || result.code === "EMAIL_NOT_VERIFIED"
        ) {
          replaceWith(accountLinkPath(paymentRedirectTo));
          return;
        }
        if (!result.retainIdempotencyKey) {
          clearPaymentIdempotencyKey("purchase", payload, idempotencyKey);
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
          `Статус оплаты требует ручной проверки. Сообщите поддержке номер операции ${result.operationId}.`,
        );
        return;
      }

      clearPaymentIdempotencyKey("purchase", payload, idempotencyKey);
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
        "Не удалось определить результат оплаты. Повторите попытку — будет использован тот же запрос и новая оплата не будет создана.",
      );
    } finally {
      if (!paymentConfirmed) {
        finishSubmitting();
      }
    }
  }

  return {
    createPayment,
    selection,
    submitError,
    submitting,
    view,
  };
}
