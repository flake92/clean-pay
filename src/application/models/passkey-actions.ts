export type PasskeyLoginOptionsResult =
  | { ok: true; options: unknown }
  | { ok: false; code: string; message: string };

export type PasskeyRegistrationOptionsResult =
  | { ok: true; options: unknown }
  | { ok: false; code: string; message: string };

export type PasskeyVerificationResult =
  | { ok: true }
  | { ok: false; code: string; message: string };
