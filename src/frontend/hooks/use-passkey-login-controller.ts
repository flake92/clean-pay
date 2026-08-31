import { useRef, useState } from "react";

import { startAuthentication } from "@simplewebauthn/browser";

import {
  beginPasskeyLoginAction,
  verifyPasskeyLoginAction,
} from "@/app/actions/passkeys";
import { passkeyLoginErrorMessage } from "@/frontend/components/passkey-presentation";
import { navigateTo } from "@/frontend/lib/browser-navigation";
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
  navigate: navigateTo,
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
      const optionsResult = await dependencies.beginLogin({
        email,
        ...(turnstileToken ? { turnstileToken } : {}),
      });
      resetTurnstile?.();

      if (!optionsResult.ok) {
        setError(optionsResult.message);
        return;
      }

      const assertion = await dependencies.startAuthentication({
        optionsJSON: optionsResult.options,
      });
      const verifyResult = await dependencies.verifyLogin(assertion);

      if (!verifyResult.ok) {
        setError(verifyResult.message);
        return;
      }

      dependencies.navigate(destination);
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
