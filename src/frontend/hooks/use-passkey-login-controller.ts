import { useReducer, useRef } from "react";

import { startAuthentication } from "@simplewebauthn/browser";

import {
  beginPasskeyLoginAction,
  verifyPasskeyLoginAction,
} from "@/app/actions/passkeys";
import {
  initialPasskeyLoginState,
  reducePasskeyLogin,
  selectPasskeyLoginView,
} from "@/frontend/components/passkey-login-transitions";
import { passkeyLoginErrorMessage } from "@/frontend/components/passkey-presentation";
import { navigateTo } from "@/frontend/lib/browser-navigation";
import { executePasskeyLogin } from "@/frontend/lib/passkey-login-orchestrator";
import { safeRedirectPath } from "@/shared/auth/redirect-policy";
import { useWebAuthnSupport } from "@/frontend/hooks/use-webauthn-support";

type PasskeyLoginDependencies = {
  beginLogin: typeof beginPasskeyLoginAction;
  navigate: typeof navigateTo;
  startAuthentication: typeof startAuthentication;
  verifyLogin: typeof verifyPasskeyLoginAction;
};

const productionPasskeyLoginDependencies: PasskeyLoginDependencies = {
  beginLogin: beginPasskeyLoginAction,
  navigate: (destination) => navigateTo(destination),
  startAuthentication,
  verifyLogin: verifyPasskeyLoginAction,
};

export function usePasskeyLoginController({
  consumeTurnstileToken,
  dependencies = productionPasskeyLoginDependencies,
  email,
  redirectTo,
  resetTurnstile,
  turnstileEnabled,
}: {
  consumeTurnstileToken?: () => string | null;
  dependencies?: PasskeyLoginDependencies;
  email: string;
  redirectTo: string;
  resetTurnstile?: () => void;
  turnstileEnabled: boolean;
}) {
  const destination = safeRedirectPath(redirectTo) ?? "/cabinet";
  const supported = useWebAuthnSupport();
  const [state, dispatch] = useReducer(
    reducePasskeyLogin,
    initialPasskeyLoginState,
  );
  const { error, loading } = selectPasskeyLoginView(state);
  const loginPendingRef = useRef(false);

  async function login() {
    if (loginPendingRef.current) {
      return;
    }

    const turnstileToken = turnstileEnabled
      ? consumeTurnstileToken?.() ?? null
      : null;
    if (turnstileEnabled && !turnstileToken) {
      dispatch({
        type: "failed",
        message: "Пройдите единую проверку безопасности.",
      });
      return;
    }
    loginPendingRef.current = true;
    dispatch({ type: "started" });

    try {
      const result = await executePasskeyLogin({
        dependencies: {
          beginLogin: dependencies.beginLogin,
          navigate: dependencies.navigate,
          resetTurnstile,
          startAuthentication: dependencies.startAuthentication,
          verifyLogin: dependencies.verifyLogin,
        },
        destination,
        email,
        turnstileToken,
      });
      if (!result.ok) dispatch({ type: "failed", message: result.message });
    } catch (caught) {
      resetTurnstile?.();
      dispatch({
        type: "failed",
        message: passkeyLoginErrorMessage(caught),
      });
    } finally {
      loginPendingRef.current = false;
      dispatch({ type: "settled" });
    }
  }

  return { error, loading, login, supported };
}
