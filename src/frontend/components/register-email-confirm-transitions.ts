export type RegisterEmailConfirmAction = "confirm" | "resend" | "back";

export type RegisterEmailConfirmTurnstileHandle = {
  reset: () => void;
};

export type RegisterEmailConfirmState = {
  loading: RegisterEmailConfirmAction | null;
  error: string | null;
  message: string | null;
  turnstileToken: string | null;
  turnstile: RegisterEmailConfirmTurnstileHandle | null;
};

export type RegisterEmailConfirmEvent =
  | {
      type: "loading-changed";
      loading: RegisterEmailConfirmAction | null;
    }
  | { type: "feedback-cleared" }
  | { type: "error-changed"; error: string | null }
  | { type: "message-changed"; message: string | null }
  | { type: "turnstile-token-changed"; token: string | null }
  | {
      type: "turnstile-changed";
      turnstile: RegisterEmailConfirmTurnstileHandle | null;
    };

export type RegisterEmailConfirmPendingTransition =
  | { accepted: true; action: RegisterEmailConfirmAction }
  | { accepted: false; action: RegisterEmailConfirmAction };

export function createInitialRegisterEmailConfirmState(): RegisterEmailConfirmState {
  return {
    loading: null,
    error: null,
    message: null,
    turnstileToken: null,
    turnstile: null,
  };
}

export function registerEmailConfirmReducer(
  state: RegisterEmailConfirmState,
  event: RegisterEmailConfirmEvent,
): RegisterEmailConfirmState {
  switch (event.type) {
    case "loading-changed":
      return { ...state, loading: event.loading };
    case "feedback-cleared":
      return { ...state, error: null, message: null };
    case "error-changed":
      return { ...state, error: event.error };
    case "message-changed":
      return { ...state, message: event.message };
    case "turnstile-token-changed":
      return { ...state, turnstileToken: event.token };
    case "turnstile-changed":
      return { ...state, turnstile: event.turnstile };
  }
}

export function beginRegisterEmailConfirmAction(
  currentAction: RegisterEmailConfirmAction | null,
  requestedAction: RegisterEmailConfirmAction,
): RegisterEmailConfirmPendingTransition {
  return currentAction
    ? { accepted: false, action: currentAction }
    : { accepted: true, action: requestedAction };
}

export function finishRegisterEmailConfirmAction(
  currentAction: RegisterEmailConfirmAction | null,
  completedAction: RegisterEmailConfirmAction,
) {
  return currentAction === completedAction ? null : currentAction;
}

export function hasRegisterEmailTurnstileToken(
  enabled: boolean,
  token: string | null,
) {
  return !enabled || Boolean(token);
}

export function missingRegisterEmailTurnstileTokenMessage(
  siteKey?: string | null,
) {
  return siteKey
    ? "Пройдите проверку Cloudflare Turnstile."
    : "Ключ сайта Cloudflare Turnstile не настроен.";
}

function optionalTurnstileToken(token: string | null) {
  return token ? { turnstileToken: token } : {};
}

export function createRegisterEmailConfirmationPayload(
  code: string,
  turnstileToken: string | null,
) {
  return {
    code,
    ...optionalTurnstileToken(turnstileToken),
  };
}

export function createRegisterEmailResendPayload(
  turnstileToken: string | null,
) {
  return optionalTurnstileToken(turnstileToken);
}

export function registerEmailResendSuccessMessage(result: {
  kind: string;
  targetEmail?: string | null;
}) {
  const targetEmail = result.kind === "code-sent"
    ? result.targetEmail ?? null
    : null;
  return targetEmail
    ? `Код повторно отправлен на ${targetEmail}.`
    : "Код повторно отправлен.";
}
