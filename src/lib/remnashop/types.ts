export type RemnashopAuthResponse = {
  expires_at: string;
  refresh_expires_at: string;
};

export type RemnashopMe = {
  telegram_id: number | null;
  auth_type: string;
  email: string | null;
  is_email_verified: boolean;
  pending_email: string | null;
  name: string;
  username: string | null;
  language: string;
};

export type RegisterRequest = {
  email: string;
  password: string;
  name?: string;
  referral_code?: string;
};

export type LoginRequest = {
  email: string;
  password: string;
};

export type RequestEmailVerificationRequest = {
  email?: string;
};

export type ConfirmEmailVerificationRequest = {
  code: string;
};

export type PurchaseRequest = {
  plan_code: string;
  duration_days: number;
  gateway_type: string;
};

export type ExtendRequest = {
  duration_days: number;
  gateway_type: string;
};
