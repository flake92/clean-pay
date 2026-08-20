export type AuthCommand =
  | { kind: "identify"; email: string; turnstileToken?: string }
  | { kind: "login"; email: string; password: string; turnstileToken?: string }
  | { kind: "register"; email: string; password: string; turnstileToken?: string }
  | { kind: "request-password-reset"; email: string; turnstileToken?: string }
  | { kind: "confirm-password-reset"; email: string; code: string; newPassword: string; turnstileToken?: string };

export type AuthCommandResult =
  | { ok: true; kind: "identified"; exists: boolean; hasPasskey: boolean }
  | {
      ok: true;
      kind: "authenticated";
      emailVerified: boolean;
      verificationRequired: boolean;
      verificationDeliveryFailed: boolean;
    }
  | { ok: true; kind: "password-reset-requested" }
  | { ok: false; code: string; message: string };

export type AuthExecutionCommand =
  | Exclude<AuthCommand, { kind: "register" }>
  | (Extract<AuthCommand, { kind: "register" }> & { referralCode?: string });

export type AuthExecutionResult =
  | Exclude<AuthCommandResult, { ok: true; kind: "authenticated" }>
  | (Extract<AuthCommandResult, { ok: true; kind: "authenticated" }> & {
      registrationFlow?: "created" | "existing_email_login";
    });
