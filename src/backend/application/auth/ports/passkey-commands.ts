import type {
  AuthenticationResponseJSON,
  PublicKeyCredentialCreationOptionsJSON,
  PublicKeyCredentialRequestOptionsJSON,
  RegistrationResponseJSON,
} from "@simplewebauthn/server";

export interface PasskeyCommands {
  beginLogin(input: { email: string; turnstileToken?: string }): Promise<PublicKeyCredentialRequestOptionsJSON>;
  finishLogin(response: AuthenticationResponseJSON): Promise<void>;
  beginRegistration(): Promise<PublicKeyCredentialCreationOptionsJSON>;
  finishRegistration(response: RegistrationResponseJSON & { name?: string }): Promise<void>;
}
