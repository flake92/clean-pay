import {
  useCallback,
  useEffect,
  useReducer,
  useRef,
  type ChangeEvent,
  type FormEvent,
} from "react";

import {
  changeProfileEmailAction,
  changeProfilePasswordAction,
  requestProfileEmailVerificationAction,
  updateEmailReminderPreferenceAction,
} from "@/app/actions/profile";
import type { ProfileViewModel } from "@/application/models/profile";
import {
  profileEmailTurnstileAction,
  selectProfilePresentation,
} from "@/frontend/components/profile-presentation";
import {
  beginProfilePendingAction,
  createInitialProfileControllerState,
  createProfileEmailPayload,
  createProfileVerificationPayload,
  finishProfilePendingAction,
  profileControllerReducer,
  type ProfileMessageSeverity,
  type ProfileTurnstileHandle,
} from "@/frontend/components/profile-transitions";
import { navigateTo } from "@/frontend/lib/browser-navigation";
import { hasTurnstileSiteKey } from "@/frontend/lib/turnstile-transitions";

function missingTurnstileTokenMessage(siteKey?: string | null) {
  return hasTurnstileSiteKey(siteKey)
    ? "Пройдите проверку Cloudflare Turnstile."
    : "Ключ сайта Cloudflare Turnstile не настроен.";
}

export function useProfileController({
  model,
  turnstileEnabled,
  turnstileSiteKey,
}: {
  model: ProfileViewModel;
  turnstileEnabled: boolean;
  turnstileSiteKey?: string | null;
}) {
  const presentation = selectProfilePresentation(model);
  const [state, dispatch] = useReducer(
    profileControllerReducer,
    presentation,
    createInitialProfileControllerState,
  );
  const emailFeedbackRef = useRef<HTMLDivElement>(null);
  const pendingActionRef = useRef<string | null>(null);

  useEffect(() => {
    if (!state.message || state.messageSeverity !== "error") return;
    const frame = requestAnimationFrame(() => {
      emailFeedbackRef.current?.focus({ preventScroll: true });
      emailFeedbackRef.current?.scrollIntoView?.({
        behavior: "smooth",
        block: "center",
      });
    });
    return () => cancelAnimationFrame(frame);
  }, [state.message, state.messageSeverity]);

  const currentEmailTarget =
    presentation.kind === "ready" ? presentation.currentEmailTarget : "";
  const emailTurnstileAction = profileEmailTurnstileAction(
    state.email,
    currentEmailTarget,
  );

  const setTurnstile = useCallback((turnstile: ProfileTurnstileHandle) => {
    dispatch({ type: "turnstile-changed", turnstile });
  }, []);
  const setTurnstileToken = useCallback((token: string | null) => {
    dispatch({ type: "turnstile-token-changed", token });
  }, []);

  function beginPendingAction(action: string) {
    const transition = beginProfilePendingAction(
      pendingActionRef.current,
      action,
    );
    if (!transition.accepted) {
      return false;
    }

    pendingActionRef.current = transition.action;
    dispatch({ type: "pending-action-changed", action: transition.action });
    return true;
  }

  function finishPendingAction(action: string) {
    const nextAction = finishProfilePendingAction(
      pendingActionRef.current,
      action,
    );
    if (nextAction === pendingActionRef.current) {
      return;
    }

    pendingActionRef.current = nextAction;
    dispatch({ type: "pending-action-changed", action: nextAction });
  }

  function showMessage(
    text: string,
    severity: ProfileMessageSeverity = "info",
  ) {
    dispatch({ type: "message-shown", message: text, severity });
  }

  function showPasswordMessage(
    text: string,
    severity: "success" | "warn",
  ) {
    dispatch({ type: "password-message-shown", message: text, severity });
  }

  function resetTurnstile() {
    state.turnstile?.reset();
    setTurnstileToken(null);
  }

  async function requestVerificationFor(nextTargetEmail: string) {
    return requestProfileEmailVerificationAction(
      createProfileVerificationPayload(
        nextTargetEmail,
        state.turnstileToken,
      ),
    );
  }

  async function changeEmail(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!beginPendingAction("email")) {
      return;
    }

    dispatch({ type: "message-cleared" });

    const nextEmail = state.email.trim();
    const isSameEmail =
      profileEmailTurnstileAction(nextEmail, currentEmailTarget) ===
      "email_verification";

    if (turnstileEnabled && !state.turnstileToken) {
      finishPendingAction("email");
      showMessage(missingTurnstileTokenMessage(turnstileSiteKey), "warn");
      return;
    }

    try {
      if (isSameEmail) {
        const result = await requestVerificationFor(nextEmail);
        if (!result.ok) {
          showMessage(result.message, "warn");
          return;
        }
        showMessage(`E-mail уже указан. ${result.message}`, "success");
        navigateTo("/verify-email");
        return;
      }

      const result = await changeProfileEmailAction(
        createProfileEmailPayload(nextEmail, state.turnstileToken),
      );
      if (!result.ok) {
        showMessage(result.message, "error");
        return;
      }
      showMessage(result.message, "success");
      navigateTo("/verify-email");
    } catch {
      showMessage("Сеть недоступна. Не удалось изменить e-mail.", "error");
    } finally {
      resetTurnstile();
      finishPendingAction("email");
    }
  }

  async function changePassword(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!beginPendingAction("password")) {
      return;
    }

    dispatch({ type: "message-cleared" });
    dispatch({ type: "password-message-cleared" });

    try {
      const result = await changeProfilePasswordAction({
        currentPassword: state.currentPassword,
        newPassword: state.newPassword,
      });
      if (!result.ok) {
        showPasswordMessage(result.message, "warn");
        return;
      }

      dispatch({ type: "passwords-cleared" });
      showPasswordMessage(result.message, "success");
    } catch {
      showPasswordMessage(
        "Сеть недоступна. Не удалось изменить пароль.",
        "warn",
      );
    } finally {
      finishPendingAction("password");
    }
  }

  async function changeEmailReminders(event: ChangeEvent<HTMLInputElement>) {
    const enabled = event.target.checked;
    if (!beginPendingAction("email-reminders")) return;
    dispatch({ type: "email-reminder-message-cleared" });

    try {
      const result = await updateEmailReminderPreferenceAction(enabled);
      if (!result.ok) {
        dispatch({
          type: "email-reminder-message-shown",
          message: result.message,
          severity: "warn",
        });
        return;
      }

      dispatch({
        type: "email-reminders-changed",
        preference: result.preference,
      });
      dispatch({
        type: "email-reminder-message-shown",
        message: result.message,
        severity: "success",
      });
    } catch {
      dispatch({
        type: "email-reminder-message-shown",
        message: "Не удалось изменить настройку уведомлений.",
        severity: "warn",
      });
    } finally {
      finishPendingAction("email-reminders");
    }
  }

  function changeEmailInput(event: ChangeEvent<HTMLInputElement>) {
    const nextEmail = event.target.value;

    if (
      state.turnstileToken &&
      profileEmailTurnstileAction(nextEmail, currentEmailTarget) !==
        emailTurnstileAction
    ) {
      resetTurnstile();
    }
    dispatch({ type: "email-changed", email: nextEmail });
  }

  function changeCurrentPassword(event: ChangeEvent<HTMLInputElement>) {
    dispatch({
      type: "current-password-changed",
      password: event.target.value,
    });
  }

  function changeNewPassword(event: ChangeEvent<HTMLInputElement>) {
    dispatch({
      type: "new-password-changed",
      password: event.target.value,
    });
  }

  return {
    ...state,
    presentation,
    user: presentation.kind === "ready" ? presentation.user : null,
    emailFeedbackRef,
    emailTurnstileAction,
    changeCurrentPassword,
    changeEmail,
    changeEmailInput,
    changeEmailReminders,
    changeNewPassword,
    changePassword,
    setTurnstile,
    setTurnstileToken,
  };
}
