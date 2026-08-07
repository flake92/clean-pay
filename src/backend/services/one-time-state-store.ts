export interface OneTimeStateStore {
  claimWebAuthnChallenge(id: string, now?: Date): Promise<boolean>;
  claimTelegramAuthState(id: string, now?: Date): Promise<boolean>;
}
