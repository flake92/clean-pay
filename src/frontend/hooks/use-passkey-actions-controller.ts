import {
  useEffect,
  useRef,
  useState,
  type ChangeEvent,
} from "react";

import {
  browserSupportsWebAuthn,
  startAuthentication,
  startRegistration,
} from "@simplewebauthn/browser";

import {
  beginPasskeyLoginAction,
  beginPasskeyRegistrationAction,
  verifyPasskeyLoginAction,
  verifyPasskeyRegistrationAction,
} from "@/app/actions/passkeys";
import { clearSessionAction } from "@/app/actions/session";
import {
  passkeyLoginErrorMessage,
  passkeySetupErrorMessage,
} from "@/frontend/components/passkey-presentation";
import { navigateTo } from "@/frontend/lib/browser-navigation";
import { safeRedirectPath } from "@/shared/auth/redirect-policy";

export function useWebAuthnSupport() {
  const [supported, setSupported] = useState<boolean | null>(null);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setSupported(browserSupportsWebAuthn());
    }, 0);

    return () => window.clearTimeout(timer);
  }, []);

  return supported;
}

export function usePasskeyLoginController({
  consumeTurnstileToken,
  email,
  redirectTo,
  resetTurnstile,
  turnstileEnabled,
}: {
  consumeTurnstileToken?: () => string | null;
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
      const optionsResult = await beginPasskeyLoginAction({
        email,
        ...(turnstileToken ? { turnstileToken } : {}),
      });
      resetTurnstile?.();

      if (!optionsResult.ok) {
        setError(optionsResult.message);
        return;
      }

      const assertion = await startAuthentication({
        optionsJSON: optionsResult.options,
      });
      const verifyResult = await verifyPasskeyLoginAction(assertion);

      if (!verifyResult.ok) {
        setError(verifyResult.message);
        return;
      }

      navigateTo(destination);
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

export function usePasskeySetupController({
  redirectTo,
  required,
}: {
  redirectTo: string;
  required: boolean;
}) {
  const destination = safeRedirectPath(redirectTo) ?? "/cabinet";
  const supported = useWebAuthnSupport();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [restarting, setRestarting] = useState(false);
  const setupPendingRef = useRef(false);

  function continueWithoutPasskey() {
    if (setupPendingRef.current) {
      return;
    }
    navigateTo(destination);
  }

  async function restartAuthentication() {
    if (setupPendingRef.current) {
      return;
    }
    setupPendingRef.current = true;
    setRestarting(true);
    setError(null);

    try {
      const result = await clearSessionAction();
      if (result.status === "error") {
        setError(result.message);
        return;
      }
      navigateTo(`/login?${new URLSearchParams({
        redirect_to: destination,
      }).toString()}`);
    } catch {
      setError("Сеть недоступна. Не удалось начать вход заново.");
    } finally {
      setupPendingRef.current = false;
      setRestarting(false);
    }
  }

  async function createPasskey() {
    if (setupPendingRef.current) {
      return;
    }
    setupPendingRef.current = true;
    setLoading(true);
    setError(null);

    try {
      if (!browserSupportsWebAuthn()) {
        setError(
          required
            ? "Это устройство не поддерживает Passkey. Используйте совместимый браузер или начните вход заново."
            : "Это устройство не поддерживает быстрый вход. Продолжите в кабинете или используйте другое устройство.",
        );
        return;
      }

      const optionsResult = await beginPasskeyRegistrationAction();

      if (!optionsResult.ok) {
        setError(optionsResult.message);
        return;
      }

      const attestation = await startRegistration({
        optionsJSON: optionsResult.options,
      });
      const verifyResult = await verifyPasskeyRegistrationAction({
        ...attestation,
        name: name.trim() || undefined,
      });

      if (!verifyResult.ok) {
        setError(verifyResult.message);
        return;
      }

      navigateTo(destination);
    } catch (caught) {
      setError(passkeySetupErrorMessage(caught, required));
    } finally {
      setupPendingRef.current = false;
      setLoading(false);
    }
  }

  function changeName(event: ChangeEvent<HTMLInputElement>) {
    setName(event.target.value);
  }

  return {
    continueWithoutPasskey,
    createPasskey,
    error,
    loading,
    name,
    restarting,
    restartAuthentication,
    supported,
    changeName,
  };
}
