import { useRef, useState } from "react";

import { startAuthentication } from "@simplewebauthn/browser";

import {
  beginPasskeyLoginAction,
  verifyPasskeyLoginAction,
} from "@/app/actions/passkeys";
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
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const loginPendingRef = useRef(false);

  async function login() {
    if (loginPendingRef.current) {
      return;
    }

    const turnstileToken = turnstileEnabled
      ? consumeTurnstileToken?.() ?? null
      : null;
    if (turnstileEnabled && !turnstileToken) {
      setError("Пройдите единую проверку безопасности.");
      return;
    }
    loginPendingRef.current = true;
    setLoading(true);
    setError(null);

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
      if (!result.ok) setError(result.message);
    } catch (caught) {
      resetTurnstile?.();
      setError(passkeyLoginErrorMessage(caught));
    } finally {
      loginPendingRef.current = false;
      setLoading(false);
    }
  }

  return { error, loading, login, supported };
}
