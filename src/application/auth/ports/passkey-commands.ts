export interface PasskeyCommands {
  verifyHuman(token: string | null): Promise<void>;
  beginLogin(email: string): Promise<unknown>;
  finishLogin(response: unknown): Promise<void>;
  beginRegistration(): Promise<unknown>;
  finishRegistration(response: unknown): Promise<void>;
}
