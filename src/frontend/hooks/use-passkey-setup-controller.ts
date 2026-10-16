import {
  useReducer,
  useRef,
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
import {
  initialPasskeySetupState,
  reducePasskeySetup,
  selectPasskeySetupView,
} from "@/frontend/components/passkey-setup-transitions";
import { passkeySetupErrorMessage } from "@/frontend/components/passkey-presentation";
import { useWebAuthnSupport } from "@/frontend/hooks/use-webauthn-support";
import { navigateTo } from "@/frontend/lib/browser-navigation";
import { executePasskeyRegistration } from "@/frontend/lib/passkey-registration-orchestrator";
import { safeRedirectPath } from "@/shared/auth/redirect-policy";

type PasskeySetupDependencies = {
  beginRegistration: typeof beginPasskeyRegistrationAction;
  navigateTo: typeof navigateTo;
  startRegistration: typeof startRegistration;
  supportsWebAuthn: typeof browserSupportsWebAuthn;
  verifyRegistration: typeof verifyPasskeyRegistrationAction;
};

const productionPasskeySetupDependencies: PasskeySetupDependencies = {
  beginRegistration: beginPasskeyRegistrationAction,
  navigateTo,
  startRegistration,
  supportsWebAuthn: browserSupportsWebAuthn,
  verifyRegistration: verifyPasskeyRegistrationAction,
};

export function usePasskeySetupController({
  dependencies = productionPasskeySetupDependencies,
  redirectTo,
}: {
  dependencies?: PasskeySetupDependencies;
  redirectTo: string;
}) {
  const destination = safeRedirectPath(redirectTo) ?? "/cabinet";
  const supported = useWebAuthnSupport(dependencies.supportsWebAuthn);
  const [state, dispatch] = useReducer(
    reducePasskeySetup,
    initialPasskeySetupState,
  );
  const { error, loading, name } = selectPasskeySetupView(state);
  const setupPendingRef = useRef(false);

  function continueWithoutPasskey() {
    if (setupPendingRef.current) {
      return;
    }
    dependencies.navigateTo(destination);
  }

  async function createPasskey() {
    if (setupPendingRef.current) {
      return;
    }
    setupPendingRef.current = true;
    dispatch({ type: "started" });

    try {
      const result = await executePasskeyRegistration({
        dependencies: {
          beginRegistration: dependencies.beginRegistration,
          navigateTo: dependencies.navigateTo,
          startRegistration: dependencies.startRegistration,
          supportsWebAuthn: dependencies.supportsWebAuthn,
          verifyRegistration: dependencies.verifyRegistration,
        },
        destination,
        name,
        unsupportedMessage: "Это устройство не поддерживает быстрый вход. Продолжите в кабинете или используйте другое устройство.",
      });
      if (!result.ok) dispatch({ type: "failed", message: result.message });
    } catch (caught) {
      dispatch({
        type: "failed",
        message: passkeySetupErrorMessage(caught),
      });
    } finally {
      setupPendingRef.current = false;
      dispatch({ type: "settled" });
    }
  }

  function changeName(event: ChangeEvent<HTMLInputElement>) {
    dispatch({ type: "name-changed", value: event.target.value });
  }

  return {
    continueWithoutPasskey,
    createPasskey,
    error,
    loading,
    name,
    supported,
    changeName,
  };
}
