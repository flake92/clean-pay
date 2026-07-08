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

export type PaymentInitResponse = {
  payment_id: string;
  payment_url: string | null;
  purchase_type: string;
  status: string;
  is_free: boolean;
  final_amount: string;
  currency: string;
};

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

type GatewayOffer = {
  gateway_type: string;
  currency: string;
  currency_symbol: string;
};

export type DurationGatewayPrice = {
  gateway_type: string;
  currency: string;
  currency_symbol: string;
  original_amount: string;
  discount_percent: number;
  final_amount: string;
  is_free: boolean;
};

type DurationOffer = {
  days: number;
  prices: DurationGatewayPrice[];
};

export type PlanOffer = {
  id: number;
  public_code: string;
  name: string;
  description: string | null;
  traffic_limit: number;
  device_limit: number;
  type: string;
  recommended_purchase_type: string;
  durations: DurationOffer[];
};

export type SubscriptionOffersResponse = {
  gateways: GatewayOffer[];
  plans: PlanOffer[];
  has_current_subscription: boolean;
  current_subscription_status: string | null;
};

export type CurrentSubscriptionResponse = {
  user_remna_id: string;
  status: string;
  is_trial: boolean;
  traffic_limit: number;
  device_limit: number;
  traffic_limit_strategy: string;
  expire_at: string;
  url: string;
  plan_name: string;
  plan_duration_days: number;
  used_traffic_bytes: number | null;
  lifetime_used_traffic_bytes: number | null;
  online_at: string | null;
};

type SubscriptionDevice = {
  hwid: string;
  platform: string | null;
  device_model: string | null;
  os_version: string | null;
  user_agent: string | null;
};

export type DevicesResponse = {
  devices: SubscriptionDevice[];
  current_count: number;
  max_count: number;
};

export type DeviceDeleteResponse = {
  deleted: boolean;
};

export type DevicesDeleteAllResponse = {
  success: boolean;
};

export type ReissueResponse = {
  success: boolean;
};

export type PromocodeActivateRequest = {
  code: string;
};

export type PromocodeActivateResponse = {
  success: boolean;
  reward_type: string;
};
