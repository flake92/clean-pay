export interface PasskeyCommands {
  beginLogin(input: { email: string; turnstileToken?: string }): Promise<unknown>;
  finishLogin(response: unknown): Promise<void>;
  beginRegistration(): Promise<unknown>;
  finishRegistration(response: unknown): Promise<void>;
}
