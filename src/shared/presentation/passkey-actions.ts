import type {
  PublicKeyCredentialCreationOptionsJSON,
  PublicKeyCredentialRequestOptionsJSON,
} from "@simplewebauthn/server";

export type PasskeyLoginOptionsResult =
  | { ok: true; options: PublicKeyCredentialRequestOptionsJSON }
  | { ok: false; code: string; message: string };

export type PasskeyRegistrationOptionsResult =
  | { ok: true; options: PublicKeyCredentialCreationOptionsJSON }
  | { ok: false; code: string; message: string };

export type PasskeyVerificationResult =
  | { ok: true }
  | { ok: false; code: string; message: string };
