import {
  authRejectedTransition,
  authStageAfterIdentification,
  type AuthFormStage,
} from "@/frontend/components/auth-form-presentation";
import { hasTurnstileSiteKey } from "@/frontend/lib/turnstile-transitions";

export type AuthApiState = {
  loading: boolean;
  error: string | null;
};

export type AuthFormControllerState = {
  stage: AuthFormStage;
  api: AuthApiState;
  email: string;
  password: string;
  passwordConfirmation: string;
  code: string;
  hasPasskey: boolean;
  canRecoverPassword: boolean;
};

export type AuthFormControllerEvent =
  | { type: "email-input-changed"; email: string }
  | { type: "password-input-changed"; password: string }
  | { type: "password-confirmation-input-changed"; password: string }
  | { type: "code-input-changed"; code: string }
  | { type: "email-change-requested" }
  | { type: "password-recovery-requested" }
  | { type: "request-started" }
  | { type: "request-rejected"; code: string; message: string }
  | { type: "request-failed"; message: string }
  | { type: "identity-resolved"; exists: boolean; hasPasskey: boolean }
  | { type: "password-reset-requested" };

export type AuthFormViewState = {
  showPasskey: boolean;
  showIdentifyMessage: boolean;
  showResetStartMessage: boolean;
  showCredentialFields: boolean;
  showRegisterMessage: boolean;
  showResetConfirmation: boolean;
  showPasswordConfirmation: boolean;
  showPasswordRecovery: boolean;
  showEmailChange: boolean;
};

export function createInitialAuthFormControllerState(
  initialError: string | null,
): AuthFormControllerState {
  return {
    stage: "identify",
    api: { loading: false, error: initialError },
    email: "",
    password: "",
    passwordConfirmation: "",
    code: "",
    hasPasskey: false,
    canRecoverPassword: false,
  };
}

export function authFormControllerReducer(
  state: AuthFormControllerState,
  event: AuthFormControllerEvent,
): AuthFormControllerState {
  switch (event.type) {
    case "email-input-changed":
      return { ...state, email: event.email };
    case "password-input-changed":
      return { ...state, password: event.password };
    case "password-confirmation-input-changed":
      return { ...state, passwordConfirmation: event.password };
    case "code-input-changed":
      return { ...state, code: event.code };
    case "email-change-requested":
      return {
        ...state,
        stage: "identify",
        api: { loading: false, error: null },
        password: "",
        passwordConfirmation: "",
        code: "",
        hasPasskey: false,
        canRecoverPassword: false,
      };
    case "password-recovery-requested":
      return {
        ...state,
        stage: "resetStart",
        api: { loading: false, error: null },
        code: "",
        password: "",
        canRecoverPassword: false,
      };
    case "request-started":
      return { ...state, api: { loading: true, error: null } };
    case "request-rejected": {
      const rejected = authRejectedTransition(state.stage, event.code);
      return {
        ...state,
        stage: rejected.stage,
        api: { loading: false, error: event.message },
        canRecoverPassword: rejected.canRecoverPassword,
      };
    }
    case "request-failed":
      return {
        ...state,
        api: { loading: false, error: event.message },
      };
    case "identity-resolved":
      return {
        ...state,
        stage: authStageAfterIdentification(event.exists),
        api: { loading: false, error: null },
        hasPasskey: event.hasPasskey,
      };
    case "password-reset-requested":
      return {
        ...state,
        stage: "resetConfirm",
        api: { loading: false, error: null },
        code: "",
        password: "",
        passwordConfirmation: "",
      };
  }
}

export function selectAuthFormView(
  state: AuthFormControllerState,
): AuthFormViewState {
  const { stage } = state;
  return {
    showPasskey: stage === "password" && state.hasPasskey,
    showIdentifyMessage: stage === "identify",
    showResetStartMessage: stage === "resetStart",
    showCredentialFields: stage !== "identify" && stage !== "resetStart",
    showRegisterMessage: stage === "register",
    showResetConfirmation: stage === "resetConfirm",
    showPasswordConfirmation:
      stage === "register" || stage === "resetConfirm",
    showPasswordRecovery:
      stage === "password" && state.canRecoverPassword,
    showEmailChange: stage !== "identify",
  };
}

export function authPasswordsMatch(
  stage: AuthFormStage,
  password: string,
  passwordConfirmation: string,
) {
  return (
    (stage !== "register" && stage !== "resetConfirm")
    || password === passwordConfirmation
  );
}

export function normalizeAuthCode(value: string) {
  return value.replace(/\D/g, "").slice(0, 6);
}

export function missingAuthTurnstileTokenMessage(siteKey?: string | null) {
  return hasTurnstileSiteKey(siteKey)
    ? "Пройдите единую проверку безопасности."
    : "Проверка безопасности временно недоступна.";
}

export function createTelegramAuthStartUrl(
  origin: string,
  redirectTo: string,
  turnstileToken: string | null,
) {
  const url = new URL("/auth/telegram/start", origin);
  url.searchParams.set("redirect_to", redirectTo);
  if (turnstileToken) {
    url.searchParams.set("turnstile_token", turnstileToken);
  }
  return url.toString();
}
