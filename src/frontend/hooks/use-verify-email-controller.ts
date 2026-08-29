"use client";

import {
  useEffect,
  useRef,
  useState,
} from "react";
import type { FormEvent } from "react";

import {
  checkAccountReadinessAction,
  confirmEmailVerificationCodeAction,
  requestEmailVerificationCodeAction,
} from "@/app/actions/email-verification";
import type { AccountReadiness } from "@/application/models/email-verification";
import { hasTurnstileSiteKey } from "@/frontend/components/turnstile-widget";
import type { TurnstileHandle } from "@/frontend/components/turnstile-widget";
import {
  accountReadinessTransition,
  confirmVerificationTransition,
  initialVerificationTransition,
  missingTurnstileTokenMessage,
  requestVerificationTransition,
  selectVerificationViewState,
} from "@/frontend/components/verify-email-state";
import type {
  VerificationMessageSeverity,
  VerificationSyncProblem,
} from "@/frontend/components/verify-email-state";
import {
  navigateTo,
  replaceWith,
} from "@/frontend/lib/browser-navigation";
import {
  accountLinkPath,
  accountSetupCompletePath,
  emailVerificationPath,
} from "@/shared/auth/account-setup-flow";

export function useVerifyEmailController({
  autoContinue,
  initialReadiness,
  redirectTo,
  turnstileEnabled,
  turnstileSiteKey,
}: {
  autoContinue: boolean;
  initialReadiness: AccountReadiness;
  redirectTo: string;
  turnstileEnabled: boolean;
  turnstileSiteKey?: string | null;
}) {
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [messageSeverity, setMessageSeverity] =
    useState<VerificationMessageSeverity>("success");
  const [confirmed, setConfirmed] = useState(false);
  const [accountSyncPending, setAccountSyncPending] = useState(false);
  const [syncProblem, setSyncProblem] =
    useState<VerificationSyncProblem>(null);
  const [loading, setLoading] = useState<string | null>(null);
  const [targetEmail, setTargetEmail] = useState<string | null>(null);
  const [turnstileToken, setTurnstileToken] = useState<string | null>(null);
  const [turnstile, setTurnstile] = useState<TurnstileHandle | null>(null);
  const actionLoadingRef = useRef<string | null>(null);
  const completedDestination = accountSetupCompletePath(redirectTo);
  const verificationDestination = emailVerificationPath(redirectTo);

  useEffect(() => {
    let alive = true;

    async function loadVerificationState() {
      const transition = initialVerificationTransition(
        initialReadiness,
        autoContinue,
      );

      if (!alive || transition.kind === "unchanged") {
        return;
      }

      setConfirmed(transition.confirmed);
      setAccountSyncPending(transition.accountSyncPending);
      if (transition.syncProblemUpdate.kind === "set") {
        setSyncProblem(transition.syncProblemUpdate.value);
      }
      setMessageSeverity(transition.severity);
      setMessage(transition.message);
      if (transition.continueToCompletedDestination) {
        replaceWith(completedDestination);
      }
    }

    void loadVerificationState();

    return () => {
      alive = false;
    };
  }, [autoContinue, completedDestination, initialReadiness]);

  function resetTurnstile() {
    turnstile?.reset();
    setTurnstileToken(null);
  }

  function beginAction(action: string) {
    if (actionLoadingRef.current !== null) {
      return false;
    }

    actionLoadingRef.current = action;
    setLoading(action);
    return true;
  }

  function finishAction(action: string) {
    if (actionLoadingRef.current !== action) {
      return;
    }

    actionLoadingRef.current = null;
    setLoading(null);
  }

  async function requestCode(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (actionLoadingRef.current !== null) {
      return;
    }
    setMessage(null);
    setError(null);

    if (turnstileEnabled && !turnstileToken) {
      setError(missingTurnstileTokenMessage(
        hasTurnstileSiteKey(turnstileSiteKey),
      ));
      return;
    }
    if (!beginAction("request")) {
      return;
    }

    try {
      const formData = new FormData(event.currentTarget);
      const email = formData.get("email");
      const result = await requestEmailVerificationCodeAction({
        ...(email ? { email: String(email) } : {}),
        ...(turnstileToken ? { turnstileToken } : {}),
      });
      const transition = requestVerificationTransition(result, autoContinue);

      if (transition.kind === "rejected") {
        resetTurnstile();
        setTargetEmail(null);
        setError(transition.error);
        if (transition.continueToPasswordRecovery) {
          replaceWith(
            accountLinkPath(redirectTo, { passwordRequired: true }),
          );
        }
        return;
      }

      if (transition.kind !== "code-sent") return;
      setTargetEmail(transition.targetEmail);
      setMessageSeverity(transition.severity);
      setMessage(transition.message);
      resetTurnstile();
    } catch {
      resetTurnstile();
      setTargetEmail(null);
      setError("Не удалось отправить код. Проверьте соединение и попробуйте снова.");
    } finally {
      finishAction("request");
    }
  }

  async function confirmCode(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (actionLoadingRef.current !== null) {
      return;
    }
    setMessage(null);
    setError(null);

    if (turnstileEnabled && !turnstileToken) {
      setError(missingTurnstileTokenMessage(
        hasTurnstileSiteKey(turnstileSiteKey),
      ));
      return;
    }
    if (!beginAction("confirm")) {
      return;
    }

    try {
      const formData = new FormData(event.currentTarget);
      const result = await confirmEmailVerificationCodeAction({
        ...(targetEmail ? { email: targetEmail } : {}),
        code: String(formData.get("code") ?? ""),
        ...(turnstileToken ? { turnstileToken } : {}),
      });
      const transition = confirmVerificationTransition(result, autoContinue);

      if (transition.kind === "rejected") {
        resetTurnstile();
        setError(transition.error);
        if (transition.continueToPasswordRecovery) {
          replaceWith(
            accountLinkPath(redirectTo, { passwordRequired: true }),
          );
        }
        return;
      }

      if (transition.kind !== "confirmed") return;
      setConfirmed(true);
      setAccountSyncPending(transition.accountSyncPending);
      setSyncProblem(transition.syncProblem);
      setMessageSeverity(transition.severity);
      setMessage(transition.message);
      resetTurnstile();

      if (transition.continueToCompletedDestination) {
        replaceWith(completedDestination);
      }
    } catch {
      resetTurnstile();
      setError("Не удалось подтвердить e-mail. Проверьте соединение и попробуйте снова.");
    } finally {
      finishAction("confirm");
    }
  }

  async function continueAfterSynchronization() {
    if (!beginAction("continue")) {
      return;
    }
    setMessageSeverity("warn");
    setMessage("Проверяем готовность аккаунта...");

    try {
      const readiness = await checkAccountReadinessAction();
      const transition = accountReadinessTransition(readiness);

      if (transition.kind === "ready") {
        setAccountSyncPending(false);
        setSyncProblem(null);
        setMessageSeverity("success");
        setMessage(transition.message);
        replaceWith(completedDestination);
        return;
      }

      if (transition.kind === "email-unverified") {
        setConfirmed(false);
        setAccountSyncPending(false);
        setSyncProblem(null);
        setMessageSeverity("warn");
        setMessage(transition.message);
        return;
      }

      setAccountSyncPending(true);
      setSyncProblem(transition.syncProblem);
      setMessage(transition.message);
    } catch {
      setAccountSyncPending(true);
      setSyncProblem(null);
      setMessageSeverity("warn");
      setMessage(
        "Не удалось проверить готовность аккаунта. Проверьте соединение и повторите позже; повторная оплата не создавалась.",
      );
    } finally {
      finishAction("continue");
    }
  }

  function continueFromConfirmation() {
    if (autoContinue && accountSyncPending) {
      void continueAfterSynchronization();
      return;
    }

    navigateTo(autoContinue ? completedDestination : "/profile");
  }

  const viewState = selectVerificationViewState({
    confirmed,
    accountSyncPending,
    syncProblem,
    error,
    message,
    messageSeverity,
  });

  return {
    accountSyncPending,
    confirmed: viewState.kind === "confirmed",
    continueFromConfirmation,
    error,
    loading,
    message,
    messageSeverity,
    requestCode,
    confirmCode,
    setTurnstile,
    setTurnstileToken,
    syncProblem,
    verificationDestination,
  };
}
