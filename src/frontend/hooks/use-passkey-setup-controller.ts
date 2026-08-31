import {
  useRef,
  useState,
  type ChangeEvent,
} from "react";

import {
  browserSupportsWebAuthn,
  startRegistration,
} from "@simplewebauthn/browser";

import {
  beginPasskeyRegistrationAction,
  verifyPasskeyRegistrationAction,
} from "@/app/actions/passkeys";
import { clearSessionAction } from "@/app/actions/session";
import { passkeySetupErrorMessage } from "@/frontend/components/passkey-presentation";
import { useWebAuthnSupport } from "@/frontend/hooks/use-webauthn-support";
import { navigateTo } from "@/frontend/lib/browser-navigation";
import { safeRedirectPath } from "@/shared/auth/redirect-policy";

type PasskeySetupDependencies = {
  beginRegistration: typeof beginPasskeyRegistrationAction;
  clearSession: typeof clearSessionAction;
  navigateTo: typeof navigateTo;
  startRegistration: typeof startRegistration;
  supportsWebAuthn: typeof browserSupportsWebAuthn;
  verifyRegistration: typeof verifyPasskeyRegistrationAction;
};

const productionPasskeySetupDependencies: PasskeySetupDependencies = {
  beginRegistration: beginPasskeyRegistrationAction,
  clearSession: clearSessionAction,
  navigateTo,
  startRegistration,
  supportsWebAuthn: browserSupportsWebAuthn,
  verifyRegistration: verifyPasskeyRegistrationAction,
};

export function usePasskeySetupController({
  dependencies = productionPasskeySetupDependencies,
  redirectTo,
  required,
}: {
  dependencies?: PasskeySetupDependencies;
  redirectTo: string;
  required: boolean;
}) {
  const destination = safeRedirectPath(redirectTo) ?? "/cabinet";
  const supported = useWebAuthnSupport(dependencies.supportsWebAuthn);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [restarting, setRestarting] = useState(false);
  const setupPendingRef = useRef(false);

  function continueWithoutPasskey() {
    if (setupPendingRef.current) {
      return;
    }
    dependencies.navigateTo(destination);
  }

  async function restartAuthentication() {
    if (setupPendingRef.current) {
      return;
    }
    setupPendingRef.current = true;
    setRestarting(true);
    setError(null);

    try {
      const result = await dependencies.clearSession();
      if (result.status === "error") {
        setError(result.message);
        return;
      }
      dependencies.navigateTo(`/login?${new URLSearchParams({
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
      if (!dependencies.supportsWebAuthn()) {
        setError(
          required
            ? "Это устройство не поддерживает Passkey. Используйте совместимый браузер или начните вход заново."
            : "Это устройство не поддерживает быстрый вход. Продолжите в кабинете или используйте другое устройство.",
        );
        return;
      }

      const optionsResult = await dependencies.beginRegistration();

      if (!optionsResult.ok) {
        setError(optionsResult.message);
        return;
      }

      const attestation = await dependencies.startRegistration({
        optionsJSON: optionsResult.options,
      });
      const verifyResult = await dependencies.verifyRegistration({
        ...attestation,
        name: name.trim() || undefined,
      });

      if (!verifyResult.ok) {
        setError(verifyResult.message);
        return;
      }

      dependencies.navigateTo(destination);
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
