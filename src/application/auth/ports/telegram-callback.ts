export type TelegramCallbackInput =
  | { kind: "oidc"; code: string; state: string }
  | { kind: "popup-oidc"; idToken: string }
  | { kind: "login-widget"; authData: Record<string, unknown> };

type TelegramCallbackSession = {
  userId: string;
  remnashopSession?: {
    accessTokenEncrypted: string;
    refreshTokenEncrypted: string;
    accessExpiresAt: Date;
    refreshExpiresAt: Date;
  };
  requiresTelegramRecovery: boolean;
};

export type TelegramCallbackOutcome = {
  redirectTo: string;
  mergeConfirmation?: { token: string };
  session?: TelegramCallbackSession;
  audit: {
    userId: string;
    remnashopLinked: boolean;
  };
};

export interface TelegramCallbackProcessor {
  complete(input: TelegramCallbackInput): Promise<TelegramCallbackOutcome>;
}
