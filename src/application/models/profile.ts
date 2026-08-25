type ProfileUserViewModel = {
  authType: string;
  email: string | null;
  emailVerified: boolean;
  pendingEmail: string | null;
  telegramId: string | null;
};

export type EmailReminderPreferenceViewModel = {
  enabled: boolean;
  emailEligible: boolean;
  senderEmail: string | null;
  daysBefore: number[];
};

export type EmailReminderPreferenceState =
  | ({ status: "ready" } & EmailReminderPreferenceViewModel)
  | { status: "unavailable" };

export type ProfileViewModel =
  | {
      status: "ready";
      user: ProfileUserViewModel;
      emailReminders: EmailReminderPreferenceState;
    }
  | { status: "unauthorized" }
  | { status: "provider-session-recovery-required" }
  | { status: "error"; message: string };

export type ProfileCommandResult =
  | { ok: true; message: string; targetEmail?: string }
  | { ok: false; code: string; message: string };

export type EmailReminderPreferenceCommandResult =
  | {
      ok: true;
      message: string;
      preference: EmailReminderPreferenceViewModel;
    }
  | { ok: false; code: string; message: string };
