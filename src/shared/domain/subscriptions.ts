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
  renewal_terms_changed?: boolean;
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

export type SubscriptionDevice = {
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
