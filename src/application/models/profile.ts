type ProfileUserViewModel = {
  authType: string;
  email: string | null;
  emailVerified: boolean;
  pendingEmail: string | null;
  telegramId: string | null;
};

export type ProfileViewModel =
  | { status: "ready"; user: ProfileUserViewModel }
  | { status: "unauthorized" }
  | { status: "error"; message: string };

export type ProfileCommandResult =
  | { ok: true; message: string; targetEmail?: string }
  | { ok: false; code: string; message: string };
