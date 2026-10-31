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
  // Explicit opt-in to news e-mail (advertising); omitted means no consent.
  email_news_consent?: boolean;
};

export type LoginRequest = {
  email: string;
  password: string;
};

export type StartGenericEmailAuthRequest = {
  email: string;
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

export type NotificationPreferencesResponse = {
  subscription_expiration_email_enabled: boolean;
  email_eligible: boolean;
  sender_email: string | null;
  days_before: number[];
  service_email_enabled: boolean;
  news_email_enabled: boolean;
  bulk_sender_email: string | null;
  push_available: boolean;
};

export type UpdateNotificationPreferencesRequest = {
  subscription_expiration_email_enabled?: boolean;
  service_email_enabled?: boolean;
  news_email_enabled?: boolean;
};

export type FeedItemResponse = {
  id: number;
  category: "SERVICE" | "NEWS";
  text_html: string;
  buttons: Array<Array<{ text: string; url: string }>>;
  media_type: string | null;
  created_at: string;
  read: boolean;
};

export type FeedPageResponse = {
  items: FeedItemResponse[];
  unread_count: number;
  next_before_id: number | null;
};

export type FeedUnreadResponse = {
  unread_count: number;
};

export type PushKeyResponse = {
  enabled: boolean;
  public_key: string | null;
};

export type PushStatusResponse = {
  devices: number;
};

export type PushSubscriptionRequest = {
  endpoint: string;
  keys: { p256dh: string; auth: string };
  user_agent?: string;
};

export type UnsubscribeResponse = {
  category: "SERVICE" | "NEWS";
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

export type ReferralProgramResponse = {
  enabled: boolean;
  referral_code: string;
  web_referral_url: string;
  invited_count: number;
  invited_with_payment_count: number;
  points_balance: number;
  total_points_issued: number;
  total_days_issued: number;
  reward_type: string;
  reward_strategy: string;
  accrual_strategy: string;
  max_level: number;
  reward_levels: Array<{ level: number; value: number }>;
};
