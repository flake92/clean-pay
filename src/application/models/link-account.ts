export type LinkAccountPasskeyViewModel = { id: string; name: string | null; createdAt: string; lastUsedAt: string | null };
export type TelegramMergeViewModel = { targetEmail: string; sourceEmailMasked: string | null; emailWillBeReplaced: boolean; telegramId: string };

export type LinkAccountViewModel =
  | {
      status: "ready";
      profile: { email: string | null; emailVerified: boolean; telegramId: string | null };
      passkeys: LinkAccountPasskeyViewModel[];
      mergeConfirmation: TelegramMergeViewModel | null;
      callbackError: string | null;
    }
  | { status: "unauthorized" }
  | { status: "error"; message: string };

export type LinkAccountCommandResult =
  | { ok: true; kind: "linked" | "verification-required" | "merge-confirmed" | "merge-cancelled" | "passkey-deleted" }
  | { ok: false; code: string; message: string };
