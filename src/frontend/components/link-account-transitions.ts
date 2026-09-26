import type {
  LinkAccountPasskeyViewModel,
  LinkAccountViewModel,
  TelegramMergeViewModel,
} from "@/application/models/link-account";
import { linkAccountDestinations } from "@/frontend/components/link-account-presentation";

export type LinkAccountTurnstileHandle = {
  reset: () => void;
};

export type LinkAccountControllerState = {
  actionLoading: string | null;
  passkeys: LinkAccountPasskeyViewModel[];
  message: string | null;
  error: string | null;
  turnstileToken: string | null;
  turnstile: LinkAccountTurnstileHandle | null;
  webAuthnSupported: boolean | null;
  mergeConfirmation: TelegramMergeViewModel | null;
};

export type LinkAccountControllerEvent =
  | { type: "action-loading-changed"; action: string | null }
  | { type: "error-changed"; error: string | null }
  | { type: "message-changed"; message: string | null }
  | { type: "merge-confirmation-changed"; confirmation: TelegramMergeViewModel | null }
  | { type: "passkey-removed"; id: string }
  | { type: "turnstile-changed"; turnstile: LinkAccountTurnstileHandle | null }
  | { type: "turnstile-token-changed"; token: string | null }
  | { type: "webauthn-support-changed"; supported: boolean };

export function createInitialLinkAccountControllerState(
  model: LinkAccountViewModel,
): LinkAccountControllerState {
  return {
    actionLoading: null,
    passkeys: model.status === "ready" ? model.passkeys : [],
    message: null,
    error:
      model.status === "error"
        ? model.message
        : model.status === "ready"
          ? model.callbackError
          : null,
    turnstileToken: null,
    turnstile: null,
    webAuthnSupported: null,
    mergeConfirmation:
      model.status === "ready" ? model.mergeConfirmation : null,
  };
}

export function linkAccountControllerReducer(
  state: LinkAccountControllerState,
  event: LinkAccountControllerEvent,
): LinkAccountControllerState {
  switch (event.type) {
    case "action-loading-changed":
      return { ...state, actionLoading: event.action };
    case "error-changed":
      return { ...state, error: event.error };
    case "message-changed":
      return { ...state, message: event.message };
    case "merge-confirmation-changed":
      return { ...state, mergeConfirmation: event.confirmation };
    case "passkey-removed":
      return {
        ...state,
        passkeys: state.passkeys.filter((passkey) => passkey.id !== event.id),
      };
    case "turnstile-changed":
      return { ...state, turnstile: event.turnstile };
    case "turnstile-token-changed":
      return { ...state, turnstileToken: event.token };
    case "webauthn-support-changed":
      return { ...state, webAuthnSupported: event.supported };
  }
}

export function selectLinkAccountPanelState({
  guided,
  model,
  passwordRequired,
  redirectTo,
  state,
}: {
  guided: boolean;
  model: LinkAccountViewModel;
  passwordRequired: boolean;
  redirectTo: string;
  state: LinkAccountControllerState;
}) {
  const profile = model.status === "ready" ? model.profile : null;
  const emailVerified = Boolean(profile?.emailVerified);
  const telegramId = profile?.telegramId ?? null;
  const hasEmail = Boolean(profile?.email);
  const hasTelegram = Boolean(telegramId);
  const hasPasskey = state.passkeys.length > 0;
  const destinations = linkAccountDestinations({
    guided,
    passwordRequired,
    redirectTo,
  });

  return {
    ...state,
    profile,
    sessionExpired: model.status === "unauthorized",
    emailVerified,
    telegramId,
    hasEmail,
    hasTelegram,
    hasPasskey,
    ...destinations,
    usesCurrentPassword: hasEmail || destinations.requiresPasswordReauth,
  };
}

export function beginLinkAccountAction(
  currentAction: string | null,
  requestedAction: string,
) {
  return currentAction !== null
    ? { accepted: false as const, action: currentAction }
    : { accepted: true as const, action: requestedAction };
}

export function finishLinkAccountAction(
  currentAction: string | null,
  completedAction: string,
) {
  return currentAction === completedAction ? null : currentAction;
}

export function shouldClearTelegramMergeConfirmation(code: string) {
  return (
    code === "ACCOUNT_MERGE_SUBSCRIPTIONS_CONFLICT" ||
    code === "ACCOUNT_MERGE_REQUIRED"
  );
}

export function readLinkAccountEmailSubmission(formData: FormData) {
  return {
    email: String(formData.get("email") ?? "").trim(),
    password: String(formData.get("password") ?? ""),
    confirmPassword: String(formData.get("confirmPassword") ?? ""),
  };
}

export function createLinkedTelegramStartUrl({
  origin,
  setupDestination,
  turnstileToken,
}: {
  origin: string;
  setupDestination: string;
  turnstileToken: string | null;
}) {
  const url = new URL("/auth/telegram/start", origin);
  url.searchParams.set("redirect_to", setupDestination);
  if (turnstileToken) {
    url.searchParams.set("turnstile_token", turnstileToken);
    url.searchParams.set("cf-turnstile-response", turnstileToken);
  }
  return url;
}
