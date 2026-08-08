export type OneTimeStateKind = "webauthn-challenge" | "telegram-auth-state";

export interface OneTimeStateRepository {
  claim(input: { kind: OneTimeStateKind; id: string; consumedAt: Date }): Promise<boolean>;
}
