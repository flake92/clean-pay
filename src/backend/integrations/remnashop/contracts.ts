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
  has_password?: boolean;
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

export type StartGenericEmailAuthRequest = {
  email: string;
};

export type CompleteGenericEmailAuthRequest = {
  email: string;
  code: string;
  password: string;
};

export type RequestPasswordResetRequest = {
  email: string;
};

export type ConfirmPasswordResetRequest = {
  email: string;
  code: string;
  new_password: string;
};

export type TelegramAuthRequest = {
  id: number;
  first_name: string;
  last_name?: string;
  username?: string;
  photo_url?: string;
  auth_date: number;
  hash: string;
};

export type TelegramWebAppAuthRequest = {
  init_data: string;
};

export type ChangePasswordRequest = {
  current_password: string;
  new_password: string;
};

export type ChangePasswordResponse = {
  success: boolean;
};

export type ChangeEmailRequest = {
  email: string;
};

export type ChangeEmailResponse = {
  success: boolean;
  pending_email: string;
};

export type RequestEmailVerificationRequest = {
  email?: string;
};

export type RequestEmailVerificationResponse = {
  success: boolean;
  target_email: string;
  expires_at: string;
};

export type ConfirmEmailVerificationRequest = {
  email?: string;
  code: string;
  registrationFlow?: boolean;
};

export type ConfirmEmailVerificationResponse = {
  success: boolean;
  email: string;
  already_verified?: boolean;
  account_sync_pending?: boolean;
};

export type {
  ExtendRequest,
  PaymentInitResponse,
  PurchaseRequest,
} from "@/shared/domain/payments";

export type PaymentTransactionResponse = {
  payment_id: string;
  purchase_type: string;
  status: string;
  gateway_type: string;
  final_amount: string;
  currency: string;
  plan_name: string | null;
  duration_days: number | null;
  device_limit: number | null;
  traffic_limit: number | null;
  created_at: string;
  updated_at: string;
};

export type {
  CurrentSubscriptionResponse,
  DevicesResponse,
  PlanOffer,
  SubscriptionOffersResponse,
} from "@/shared/domain/subscriptions";

export type DeviceDeleteResponse = {
  deleted: boolean;
};

export type DevicesDeleteAllResponse = {
  success: boolean;
};

export type ReissueResponse = {
  success: boolean;
};

export type PromocodeActivateResponse = {
  success: boolean;
  reward_type: string;
};
