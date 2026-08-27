import {
  useCallback,
  useMemo,
  useReducer,
  useRef,
  useState,
  type ChangeEvent,
  type FormEvent,
} from "react";

import { executeAuthAction } from "@/app/actions/auth";
import { authCommandForStage } from "@/frontend/components/auth-form-presentation";
import {
  authFormControllerReducer,
  authPasswordsMatch,
  createInitialAuthFormControllerState,
  createTelegramAuthStartUrl,
  missingAuthTurnstileTokenMessage,
  normalizeAuthCode,
} from "@/frontend/components/auth-form-transitions";
import { registrationEmailVerificationPath } from "@/shared/auth/account-setup-flow";
import { safeRedirectPath } from "@/shared/auth/redirect-policy";

type AuthTurnstileHandle = {
  reset: () => void;
};

export type AuthTurnstileControllerValue = {
  enabled: boolean;
  siteKey: string | null;
  token: string | null;
  consumeToken: () => string | null;
  reset: () => void;
  setHandle: (handle: AuthTurnstileHandle) => void;
  setToken: (token: string | null) => void;
};

const unknownLoginResultMessage =
  "Не удалось определить результат входа. Обновите страницу, чтобы проверить состояние сессии.";

function defaultRedirectAfterAuth(redirectTo: string) {
  window.location.assign(safeRedirectPath(redirectTo) ?? "/cabinet");
}

export function useAuthTurnstileController({
  enabled,
  siteKey,
}: {
  enabled: boolean;
  siteKey?: string | null;
}): AuthTurnstileControllerValue {
  const [token, setToken] = useState<string | null>(null);
  const [handle, setHandle] = useState<AuthTurnstileHandle | null>(null);
  const tokenRef = useRef<string | null>(null);
  const updateToken = useCallback((nextToken: string | null) => {
    tokenRef.current = nextToken;
    setToken(nextToken);
  }, []);
  const consumeToken = useCallback(() => {
    const currentToken = tokenRef.current;
    tokenRef.current = null;
    setToken(null);
    return currentToken;
  }, []);
  const reset = useCallback(() => {
    handle?.reset();
    updateToken(null);
  }, [handle, updateToken]);

  return useMemo(() => ({
    enabled,
    siteKey: siteKey ?? null,
    token: enabled ? token : null,
    consumeToken,
    reset,
    setHandle,
    setToken: updateToken,
  }), [consumeToken, enabled, reset, siteKey, token, updateToken]);
}

export function useAuthFormController({
  initialError,
  navigateAfterAuth: redirectAfterAuth = defaultRedirectAfterAuth,
  redirectTo,
  turnstile,
}: {
  initialError: string | null;
  navigateAfterAuth?: (destination: string) => void;
  redirectTo: string;
  turnstile: AuthTurnstileControllerValue;
}) {
  const [state, dispatch] = useReducer(
    authFormControllerReducer,
    initialError,
    createInitialAuthFormControllerState,
  );
  const requestPendingRef = useRef(false);

  function changeEmail() {
    dispatch({ type: "email-change-requested" });
    turnstile.reset();
  }

  function requestPasswordRecovery() {
    dispatch({ type: "password-recovery-requested" });
  }

  function changeEmailInput(event: ChangeEvent<HTMLInputElement>) {
    dispatch({ type: "email-input-changed", email: event.target.value });
  }

  function changePasswordInput(event: ChangeEvent<HTMLInputElement>) {
    dispatch({ type: "password-input-changed", password: event.target.value });
  }

  function changePasswordConfirmationInput(event: ChangeEvent<HTMLInputElement>) {
    dispatch({
      type: "password-confirmation-input-changed",
      password: event.target.value,
    });
  }

  function changeCodeInput(event: ChangeEvent<HTMLInputElement>) {
    dispatch({
      type: "code-input-changed",
      code: normalizeAuthCode(event.target.value),
    });
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (requestPendingRef.current) {
      return;
    }
    if (!authPasswordsMatch(
      state.stage,
      state.password,
      state.passwordConfirmation,
    )) {
      dispatch({ type: "request-failed", message: "Пароли не совпадают." });
      return;
    }
    const turnstileToken = turnstile.enabled ? turnstile.consumeToken() : null;
    if (turnstile.enabled && !turnstileToken) {
      dispatch({
        type: "request-failed",
        message: missingAuthTurnstileTokenMessage(turnstile.siteKey),
      });
      return;
    }

    requestPendingRef.current = true;
    dispatch({ type: "request-started" });
    try {
      const command = authCommandForStage(
        state.stage,
        { email: state.email, password: state.password, code: state.code },
        turnstileToken,
      );
      const result = await executeAuthAction(command);
      turnstile.reset();
      if (!result.ok) {
        dispatch({
          type: "request-rejected",
          code: result.code,
          message: result.message,
        });
        return;
      }
      if (state.stage === "identify") {
        if (result.kind !== "identified") {
          dispatch({
            type: "request-failed",
            message: "Сервер вернул некорректный ответ. Повторите попытку.",
          });
          return;
        }
        dispatch({
          type: "identity-resolved",
          exists: result.exists,
          hasPasskey: result.hasPasskey,
        });
        return;
      }
      if (state.stage === "resetStart") {
        dispatch({ type: "password-reset-requested" });
        return;
      }
      if (state.stage === "register") {
        if (result.kind !== "authenticated") {
          dispatch({ type: "request-failed", message: unknownLoginResultMessage });
          return;
        }
        if (result.emailVerified || !result.verificationRequired) {
          redirectAfterAuth(redirectTo);
        } else {
          redirectAfterAuth(registrationEmailVerificationPath(redirectTo, {
            deliveryFailed: result.verificationDeliveryFailed,
          }));
        }
        return;
      }
      redirectAfterAuth(redirectTo);
    } catch {
      turnstile.reset();
      dispatch({ type: "request-failed", message: unknownLoginResultMessage });
    } finally {
      requestPendingRef.current = false;
    }
  }

  return {
    ...state,
    changeCodeInput,
    changeEmail,
    changeEmailInput,
    changePasswordConfirmationInput,
    changePasswordInput,
    requestPasswordRecovery,
    submit,
  };
}

export function useTelegramLoginController({
  redirectTo,
  turnstile,
}: {
  redirectTo: string;
  turnstile: AuthTurnstileControllerValue;
}) {
  const [state, setState] = useState({ loading: false, error: null as string | null });

  function login() {
    const telegramToken = turnstile.enabled ? turnstile.consumeToken() : null;
    if (turnstile.enabled && !telegramToken) {
      setState({
        loading: false,
        error: missingAuthTurnstileTokenMessage(turnstile.siteKey),
      });
      return;
    }
    setState({ loading: true, error: null });
    try {
      window.location.assign(createTelegramAuthStartUrl(
        window.location.origin,
        redirectTo,
        telegramToken,
      ));
    } catch {
      turnstile.reset();
      setState({
        loading: false,
        error: "Не удалось открыть вход через Telegram. Повторите попытку.",
      });
    }
  }

  return { ...state, login };
}
