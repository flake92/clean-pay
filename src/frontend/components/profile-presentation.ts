import type {
  EmailReminderPreferenceViewModel,
  ProfileViewModel,
} from "@/application/models/profile";

type ReadyProfile = Extract<ProfileViewModel, { status: "ready" }>;

export type ProfilePresentationState =
  | { kind: "error"; message: string }
  | { kind: "empty" }
  | {
      kind: "ready";
      user: ReadyProfile["user"];
      initialEmailReminders: EmailReminderPreferenceViewModel | null;
      currentEmailTarget: string;
      hasEmail: boolean;
      isEmailVerified: boolean;
      isTelegramOnly: boolean;
      canManageRemnashopEmail: boolean;
      canChangePassword: boolean;
    };

export function profileAuthTypeLabel(value: string) {
  const labels: Record<string, string> = {
    email: "E-mail",
    passkey: "Ключ доступа",
    telegram: "Telegram",
  };

  return labels[value] ?? value;
}

export function profileReminderDaysLabel(days: number[]) {
  if (days.length === 0) return "заранее";
  if (days.length === 1) return `за ${days[0]} день`;
  return `за ${days.slice(0, -1).join(", ")} и ${days.at(-1)} день`;
}

export function profileEmailTurnstileAction(
  candidate: string,
  currentEmailTarget: string,
) {
  return candidate.trim().toLowerCase() === currentEmailTarget.toLowerCase()
    ? "email_verification"
    : "email_change";
}

export function selectProfilePresentation(
  model: ProfileViewModel,
): ProfilePresentationState {
  if (model.status === "error") return { kind: "error", message: model.message };
  if (model.status !== "ready") return { kind: "empty" };

  const { user } = model;
  const hasEmail = Boolean(user.email);
  return {
    kind: "ready",
    user,
    initialEmailReminders: model.emailReminders.status === "ready"
      ? model.emailReminders
      : null,
    currentEmailTarget: user.pendingEmail ?? user.email ?? "",
    hasEmail,
    isEmailVerified: hasEmail && user.emailVerified,
    isTelegramOnly: Boolean(user.telegramId) && !user.email,
    canManageRemnashopEmail: Boolean(user.email),
    canChangePassword: hasEmail,
  };
}
