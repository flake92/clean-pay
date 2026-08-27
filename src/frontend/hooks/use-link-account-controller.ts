import {
  useCallback,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  type FormEvent,
} from "react";

import { browserSupportsWebAuthn } from "@simplewebauthn/browser";

import {
  cancelLinkedTelegramAction,
  confirmLinkedTelegramAction,
  linkAccountEmailAction,
  removeLinkedPasskeyAction,
} from "@/app/actions/link-account";
import type { LinkAccountViewModel } from "@/application/models/link-account";
import { linkAccountPasskeyDescription } from "@/frontend/components/link-account-presentation";
import {
  beginLinkAccountAction,
  createInitialLinkAccountControllerState,
  createLinkedTelegramStartUrl,
  finishLinkAccountAction,
  linkAccountControllerReducer,
  readLinkAccountEmailSubmission,
  selectLinkAccountPanelState,
  shouldClearTelegramMergeConfirmation,
  type LinkAccountTurnstileHandle,
} from "@/frontend/components/link-account-transitions";
import { navigateTo, replaceWith } from "@/frontend/lib/browser-navigation";
import { hasTurnstileSiteKey } from "@/frontend/lib/turnstile-transitions";
import { accountSetupCompletePath } from "@/shared/auth/account-setup-flow";

function missingTurnstileTokenMessage(siteKey?: string | null) {
  return hasTurnstileSiteKey(siteKey)
    ? "Пройдите проверку Cloudflare Turnstile."
    : "Cloudflare Turnstile site key is not configured.";
}

export function useLinkAccountController({
  guided,
  model,
  passwordRequired,
  redirectTo,
  turnstileEnabled,
  turnstileSiteKey,
}: {
  guided: boolean;
  model: LinkAccountViewModel;
  passwordRequired: boolean;
  redirectTo: string;
  turnstileEnabled: boolean;
  turnstileSiteKey?: string | null;
}) {
  const [state, dispatch] = useReducer(
    linkAccountControllerReducer,
    model,
    createInitialLinkAccountControllerState,
  );
  const actionLoadingRef = useRef<string | null>(null);
  const panelState = selectLinkAccountPanelState({
    guided,
    model,
    passwordRequired,
    redirectTo,
    state,
  });
  const passkeyDescription = useMemo(
    () =>
      linkAccountPasskeyDescription(
        panelState.hasPasskey,
        panelState.webAuthnSupported,
      ),
    [panelState.hasPasskey, panelState.webAuthnSupported],
  );

  useEffect(() => {
    const timer = window.setTimeout(() => {
      dispatch({
        type: "webauthn-support-changed",
        supported: browserSupportsWebAuthn(),
      });
    }, 0);

    return () => window.clearTimeout(timer);
  }, []);

  useEffect(() => {
    if (
      guided &&
      panelState.hasEmail &&
      panelState.emailVerified &&
      !panelState.mergeConfirmation &&
      !panelState.requiresPasswordReauth
    ) {
      navigateTo(accountSetupCompletePath(redirectTo));
    }
  }, [
    guided,
    panelState.emailVerified,
    panelState.hasEmail,
    panelState.mergeConfirmation,
    panelState.requiresPasswordReauth,
    redirectTo,
  ]);

  const setTurnstile = useCallback((turnstile: LinkAccountTurnstileHandle) => {
    dispatch({ type: "turnstile-changed", turnstile });
  }, []);
  const setTurnstileToken = useCallback((token: string | null) => {
    dispatch({ type: "turnstile-token-changed", token });
  }, []);

  function setError(error: string | null) {
    dispatch({ type: "error-changed", error });
  }

  function setMessage(message: string | null) {
    dispatch({ type: "message-changed", message });
  }

  function beginAction(action: string) {
    const transition = beginLinkAccountAction(
      actionLoadingRef.current,
      action,
    );
    if (!transition.accepted) {
      return false;
    }

    actionLoadingRef.current = transition.action;
    dispatch({ type: "action-loading-changed", action: transition.action });
    return true;
  }

  function finishAction(action: string) {
    const nextAction = finishLinkAccountAction(
      actionLoadingRef.current,
      action,
    );
    if (nextAction === actionLoadingRef.current) {
      return;
    }

    actionLoadingRef.current = nextAction;
    dispatch({ type: "action-loading-changed", action: nextAction });
  }

  async function confirmTelegramMerge() {
    const action = "telegram-merge-confirm";
    if (!beginAction(action)) {
      return;
    }
    setError(null);

    try {
      const result = await confirmLinkedTelegramAction();
      if (!result.ok) {
        setError(result.message);
        if (shouldClearTelegramMergeConfirmation(result.code)) {
          dispatch({
            type: "merge-confirmation-changed",
            confirmation: null,
          });
          window.history.replaceState({}, "", "/link-account");
        }
        return;
      }

      navigateTo(
        guided ? accountSetupCompletePath(redirectTo) : redirectTo,
      );
    } catch {
      setError("Сеть недоступна. Не удалось объединить аккаунты.");
    } finally {
      finishAction(action);
    }
  }

  async function cancelTelegramMerge() {
    const action = "telegram-merge-cancel";
    if (!beginAction(action)) {
      return;
    }
    setError(null);

    try {
      const result = await cancelLinkedTelegramAction();
      if (!result.ok) {
        setError(result.message);
        return;
      }

      dispatch({
        type: "merge-confirmation-changed",
        confirmation: null,
      });
      window.history.replaceState({}, "", "/link-account");
      setMessage("Объединение аккаунтов отменено. Данные не изменены.");
    } catch {
      setError("Сеть недоступна. Не удалось отменить объединение.");
    } finally {
      finishAction(action);
    }
  }

  function linkTelegram() {
    if (actionLoadingRef.current !== null) {
      return;
    }
    setMessage(null);
    setError(null);

    if (turnstileEnabled && !panelState.turnstileToken) {
      setError(missingTurnstileTokenMessage(turnstileSiteKey));
      return;
    }

    if (!beginAction("telegram")) {
      return;
    }
    const url = createLinkedTelegramStartUrl({
      origin: window.location.origin,
      setupDestination: panelState.setupDestination,
      turnstileToken: panelState.turnstileToken,
    });
    window.location.assign(url.toString());
  }

  async function deletePasskey(id: string) {
    const action = `passkey-${id}`;
    if (!beginAction(action)) {
      return;
    }
    setMessage(null);
    setError(null);

    try {
      const result = await removeLinkedPasskeyAction(id);
      if (!result.ok) {
        setError(result.message);
        return;
      }

      setMessage("Ключ быстрого входа удалён.");
      dispatch({ type: "passkey-removed", id });
    } catch {
      setError("Сеть недоступна. Не удалось удалить ключ быстрого входа.");
    } finally {
      finishAction(action);
    }
  }

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (actionLoadingRef.current !== null) {
      return;
    }
    setMessage(null);
    setError(null);

    const { email, password, confirmPassword } =
      readLinkAccountEmailSubmission(new FormData(event.currentTarget));

    if (!panelState.hasEmail && password !== confirmPassword) {
      setError("Пароли не совпадают.");
      return;
    }

    if (!beginAction("email")) {
      return;
    }

    try {
      const result = await linkAccountEmailAction({ email, password });
      if (!result.ok) {
        if (result.code === "UNAUTHORIZED") {
          setError(null);
          replaceWith(panelState.loginDestination);
          return;
        }

        panelState.turnstile?.reset();
        setTurnstileToken(null);
        setError(result.message);
        return;
      }
      if (result.kind === "linked") {
        setMessage("E-mail и пароль подключены.");
        navigateTo(accountSetupCompletePath(redirectTo));
        return;
      }

      navigateTo(panelState.verificationDestination);
    } catch {
      panelState.turnstile?.reset();
      setTurnstileToken(null);
      setError("Сеть недоступна. Не удалось связать e-mail с аккаунтом.");
    } finally {
      finishAction("email");
    }
  }

  function verifyEmail() {
    navigateTo(panelState.verificationDestination);
  }

  function setupPasskey() {
    navigateTo("/passkey/setup");
  }

  function skipPasskey() {
    navigateTo("/cabinet");
  }

  return {
    ...panelState,
    passkeyDescription,
    cancelTelegramMerge,
    confirmTelegramMerge,
    deletePasskey,
    linkTelegram,
    onSubmit,
    setTurnstile,
    setTurnstileToken,
    setupPasskey,
    skipPasskey,
    verifyEmail,
  };
}
