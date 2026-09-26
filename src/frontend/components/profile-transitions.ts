import type {
  EmailReminderPreferenceViewModel,
} from "@/application/models/profile";
import type { ProfilePresentationState } from "@/frontend/components/profile-presentation";

export type ProfileMessageSeverity = "success" | "info" | "warn" | "error";
export type ProfileFormMessageSeverity = "success" | "warn";

export type ProfileTurnstileHandle = {
  reset: () => void;
};

export type ProfileControllerState = {
  email: string;
  currentPassword: string;
  newPassword: string;
  message: string | null;
  messageSeverity: ProfileMessageSeverity;
  passwordMessage: string | null;
  passwordMessageSeverity: ProfileFormMessageSeverity;
  pendingAction: string | null;
  emailReminders: EmailReminderPreferenceViewModel | null;
  emailReminderMessage: string | null;
  emailReminderSeverity: ProfileFormMessageSeverity;
  turnstileToken: string | null;
  turnstile: ProfileTurnstileHandle | null;
};

export type ProfileControllerEvent =
  | { type: "email-changed"; email: string }
  | { type: "current-password-changed"; password: string }
  | { type: "new-password-changed"; password: string }
  | { type: "message-cleared" }
  | {
      type: "message-shown";
      message: string;
      severity: ProfileMessageSeverity;
    }
  | { type: "password-message-cleared" }
  | {
      type: "password-message-shown";
      message: string;
      severity: ProfileFormMessageSeverity;
    }
  | { type: "pending-action-changed"; action: string | null }
  | {
      type: "email-reminders-changed";
      preference: EmailReminderPreferenceViewModel;
    }
  | { type: "email-reminder-message-cleared" }
  | {
      type: "email-reminder-message-shown";
      message: string;
      severity: ProfileFormMessageSeverity;
    }
  | { type: "turnstile-token-changed"; token: string | null }
  | { type: "turnstile-changed"; turnstile: ProfileTurnstileHandle | null }
  | { type: "passwords-cleared" };

export function createInitialProfileControllerState(
  presentation: ProfilePresentationState,
): ProfileControllerState {
  const user = presentation.kind === "ready" ? presentation.user : null;

  return {
    email: user?.pendingEmail ?? user?.email ?? "",
    currentPassword: "",
    newPassword: "",
    message: null,
    messageSeverity: "info",
    passwordMessage: null,
    passwordMessageSeverity: "success",
    pendingAction: null,
    emailReminders:
      presentation.kind === "ready"
        ? presentation.initialEmailReminders
        : null,
    emailReminderMessage: null,
    emailReminderSeverity: "success",
    turnstileToken: null,
    turnstile: null,
  };
}

export function profileControllerReducer(
  state: ProfileControllerState,
  event: ProfileControllerEvent,
): ProfileControllerState {
  switch (event.type) {
    case "email-changed":
      return { ...state, email: event.email };
    case "current-password-changed":
      return { ...state, currentPassword: event.password };
    case "new-password-changed":
      return { ...state, newPassword: event.password };
    case "message-cleared":
      return { ...state, message: null };
    case "message-shown":
      return {
        ...state,
        message: event.message,
        messageSeverity: event.severity,
      };
    case "password-message-cleared":
      return { ...state, passwordMessage: null };
    case "password-message-shown":
      return {
        ...state,
        passwordMessage: event.message,
        passwordMessageSeverity: event.severity,
      };
    case "pending-action-changed":
      return { ...state, pendingAction: event.action };
    case "email-reminders-changed":
      return { ...state, emailReminders: event.preference };
    case "email-reminder-message-cleared":
      return { ...state, emailReminderMessage: null };
    case "email-reminder-message-shown":
      return {
        ...state,
        emailReminderMessage: event.message,
        emailReminderSeverity: event.severity,
      };
    case "turnstile-token-changed":
      return { ...state, turnstileToken: event.token };
    case "turnstile-changed":
      return { ...state, turnstile: event.turnstile };
    case "passwords-cleared":
      return { ...state, currentPassword: "", newPassword: "" };
  }
}

export function beginProfilePendingAction(
  currentAction: string | null,
  requestedAction: string,
) {
  return currentAction
    ? { accepted: false as const, action: currentAction }
    : { accepted: true as const, action: requestedAction };
}

export function finishProfilePendingAction(
  currentAction: string | null,
  completedAction: string,
) {
  return currentAction === completedAction ? null : currentAction;
}

export function createProfileEmailPayload(
  email: string,
  turnstileToken: string | null,
) {
  return {
    email,
    ...(turnstileToken ? { turnstileToken } : {}),
  };
}

export function createProfileVerificationPayload(
  email: string,
  turnstileToken: string | null,
) {
  return {
    ...(email ? { email } : {}),
    ...(turnstileToken ? { turnstileToken } : {}),
  };
}
