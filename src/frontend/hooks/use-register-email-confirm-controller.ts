import {
  useCallback,
  useReducer,
  useRef,
  type FormEvent,
} from "react";

import {
  confirmEmailVerificationCodeAction,
  requestEmailVerificationCodeAction,
} from "@/app/actions/email-verification";
import { clearSessionAction as clearSessionActionDependency } from "@/app/actions/session";
import {
  beginRegisterEmailConfirmAction,
  createInitialRegisterEmailConfirmState,
  createRegisterEmailConfirmationPayload,
  createRegisterEmailResendPayload,
  finishRegisterEmailConfirmAction,
  hasRegisterEmailTurnstileToken,
  missingRegisterEmailTurnstileTokenMessage,
  registerEmailConfirmReducer,
  registerEmailResendSuccessMessage,
  type RegisterEmailConfirmAction,
  type RegisterEmailConfirmTurnstileHandle,
} from "@/frontend/components/register-email-confirm-transitions";
import { navigateTo } from "@/frontend/lib/browser-navigation";
import { resetChatwootSession as resetChatwootSessionDependency } from "@/frontend/lib/chatwoot";
import { passkeySetupPath as passkeySetupPathDependency } from "@/shared/auth/account-setup-flow";

export const registerEmailConfirmComposition = {
  resetChatwootSession: () => resetChatwootSessionDependency,
  clearSessionAction: () => clearSessionActionDependency,
  passkeySetupPath: (redirectTo: string) => passkeySetupPathDependency(redirectTo),
};

function registerEmailBackPath(redirectTo: string) {
  return `/register?${new URLSearchParams({
    redirect_to: redirectTo,
  }).toString()}`;
}

export function useRegisterEmailConfirmController({
  clearSession,
  passkeyDestination,
  redirectTo,
  resetSupportSession,
  turnstileEnabled,
  turnstileSiteKey,
}: {
  clearSession: typeof clearSessionActionDependency;
  passkeyDestination: string;
  redirectTo: string;
  resetSupportSession: typeof resetChatwootSessionDependency;
  turnstileEnabled: boolean;
  turnstileSiteKey?: string | null;
}) {
  const [state, dispatch] = useReducer(
    registerEmailConfirmReducer,
    undefined,
    createInitialRegisterEmailConfirmState,
  );
  const loadingRef = useRef<RegisterEmailConfirmAction | null>(null);

  const setTurnstileToken = useCallback((token: string | null) => {
    dispatch({ type: "turnstile-token-changed", token });
  }, []);
  const setTurnstile = useCallback((
    turnstile: RegisterEmailConfirmTurnstileHandle,
  ) => {
    dispatch({ type: "turnstile-changed", turnstile });
  }, []);

  function beginLoading(action: RegisterEmailConfirmAction) {
    const transition = beginRegisterEmailConfirmAction(
      loadingRef.current,
      action,
    );
    if (!transition.accepted) {
      return false;
    }

    loadingRef.current = transition.action;
    dispatch({ type: "loading-changed", loading: transition.action });
    return true;
  }

  function finishLoading(action: RegisterEmailConfirmAction) {
    const nextAction = finishRegisterEmailConfirmAction(
      loadingRef.current,
      action,
    );
    if (nextAction === loadingRef.current) {
      return;
    }

    loadingRef.current = nextAction;
    dispatch({ type: "loading-changed", loading: nextAction });
  }

  function ensureTurnstileToken() {
    if (hasRegisterEmailTurnstileToken(
      turnstileEnabled,
      state.turnstileToken,
    )) {
      return true;
    }

    dispatch({
      type: "error-changed",
      error: missingRegisterEmailTurnstileTokenMessage(turnstileSiteKey),
    });
    return false;
  }

  function resetTurnstile() {
    state.turnstile?.reset();
    setTurnstileToken(null);
  }

  async function goBackToRegister() {
    if (!beginLoading("back")) {
      return;
    }

    dispatch({ type: "error-changed", error: null });

    try {
      resetSupportSession();
      const result = await clearSession();

      if (result.status === "error") {
        dispatch({ type: "error-changed", error: result.message });
        return;
      }

      navigateTo(registerEmailBackPath(redirectTo));
    } catch {
      dispatch({
        type: "error-changed",
        error: "Сеть недоступна. Не удалось вернуться к регистрации.",
      });
    } finally {
      finishLoading("back");
    }
  }

  async function resendCode() {
    dispatch({ type: "feedback-cleared" });

    if (!ensureTurnstileToken()) {
      return;
    }

    if (!beginLoading("resend")) {
      return;
    }

    try {
      const result = await requestEmailVerificationCodeAction(
        createRegisterEmailResendPayload(state.turnstileToken),
      );

      if (!result.ok) {
        resetTurnstile();
        dispatch({ type: "error-changed", error: result.message });
        return;
      }

      dispatch({
        type: "message-changed",
        message: registerEmailResendSuccessMessage(result),
      });
      resetTurnstile();
    } catch {
      resetTurnstile();
      dispatch({
        type: "error-changed",
        error: "Сеть недоступна. Не удалось повторно отправить код.",
      });
    } finally {
      finishLoading("resend");
    }
  }

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    dispatch({ type: "feedback-cleared" });

    if (!ensureTurnstileToken()) {
      return;
    }

    if (!beginLoading("confirm")) {
      return;
    }

    const formData = new FormData(event.currentTarget);
    try {
      const result = await confirmEmailVerificationCodeAction(
        createRegisterEmailConfirmationPayload(
          String(formData.get("code") ?? ""),
          state.turnstileToken,
        ),
      );

      if (!result.ok) {
        resetTurnstile();
        dispatch({ type: "error-changed", error: result.message });
        return;
      }

      navigateTo(passkeyDestination);
    } catch {
      resetTurnstile();
      dispatch({
        type: "error-changed",
        error: "Сеть недоступна. Не удалось подтвердить e-mail.",
      });
    } finally {
      finishLoading("confirm");
    }
  }

  return {
    ...state,
    goBackToRegister,
    onSubmit,
    resendCode,
    setTurnstile,
    setTurnstileToken,
  };
}
