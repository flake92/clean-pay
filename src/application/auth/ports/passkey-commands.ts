export class PasskeyGatewayError extends Error {
  constructor(public readonly code: string) { super(code); }
}

export type PasskeyRegistrationActor = {
  context: unknown;
  userId: string;
  assuranceLevel: "FULL" | "BOOTSTRAP";
  email: string | null;
  emailVerified: boolean;
  telegramId: string | null;
  telegramUsername: string | null;
  displayName: string | null;
  fullName: string | null;
  hasPendingAccountMerge: boolean;
};

export type PasskeyChallenge = { context: unknown; challenge: string; userId: string | null };
type PasskeyLoginAccount = {
  context: unknown;
  userId: string;
  credentials: Array<{ id: string; transports: string[] }>;
};
export type PasskeyCredential = {
  context: unknown;
  id: string;
  userId: string;
  credentialId: string;
  oldCounter: bigint;
};
type VerifiedRegistration = { context: unknown; credentialId: string };
type VerifiedAuthentication = { newCounter: bigint };

export interface PasskeyCommands {
  verifyHuman(token: string | null): Promise<void>;
  loadRegistrationActor(): Promise<PasskeyRegistrationActor | null>;
  generateRegistrationOptions(actor: PasskeyRegistrationActor): Promise<unknown>;
  registrationChallenge(options: unknown): string;
  storeRegistrationChallenge(actor: PasskeyRegistrationActor, challenge: string): Promise<void>;
  consumeRegistrationChallenge(response: unknown): Promise<PasskeyChallenge>;
  verifyRegistration(response: unknown, challenge: PasskeyChallenge): Promise<VerifiedRegistration>;
  persistRegistration(actor: PasskeyRegistrationActor, response: unknown, registration: VerifiedRegistration): Promise<void>;
  markRegistrationComplete(actor: PasskeyRegistrationActor): Promise<void>;
  upgradeRegistrationSession(): Promise<void>;
  auditRegistration(actor: PasskeyRegistrationActor, registration: VerifiedRegistration, upgraded: boolean): Promise<void>;
  assertLoginOptionsRateLimit(email: string): Promise<void>;
  withLoginOptionsConcurrency<T>(work: () => Promise<T>): Promise<T>;
  findLoginAccount(email: string): Promise<PasskeyLoginAccount | null>;
  generateLoginOptions(account: PasskeyLoginAccount): Promise<unknown>;
  loginChallenge(options: unknown): string;
  storeLoginChallenge(account: PasskeyLoginAccount, challenge: string): Promise<void>;
  assertLoginVerificationRateLimit(): Promise<void>;
  consumeLoginChallenge(response: unknown): Promise<PasskeyChallenge>;
  findCredential(response: unknown): Promise<PasskeyCredential | null>;
  verifyAuthentication(response: unknown, challenge: PasskeyChallenge, credential: PasskeyCredential): Promise<VerifiedAuthentication>;
  recordAuthentication(credential: PasskeyCredential, verification: VerifiedAuthentication): Promise<void>;
  createAuthenticatedSession(userId: string): Promise<{ id: string }>;
  auditLogin(credential: PasskeyCredential, sessionId: string): Promise<void>;
}

export type PasskeyLoginCommands = Pick<
  PasskeyCommands,
  | "assertLoginOptionsRateLimit"
  | "assertLoginVerificationRateLimit"
  | "auditLogin"
  | "consumeLoginChallenge"
  | "createAuthenticatedSession"
  | "findCredential"
  | "findLoginAccount"
  | "generateLoginOptions"
  | "loginChallenge"
  | "recordAuthentication"
  | "storeLoginChallenge"
  | "verifyAuthentication"
  | "verifyHuman"
  | "withLoginOptionsConcurrency"
>;
