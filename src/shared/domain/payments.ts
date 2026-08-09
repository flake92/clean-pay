export type PurchaseRequest = {
  plan_code: string;
  duration_days: number;
  gateway_type: string;
  confirmed_amount: string;
  confirmed_currency: string;
  offer_version: string;
  return_url?: string;
};

export type ExtendRequest = {
  duration_days: number;
  gateway_type: string;
  confirmed_amount: string;
  confirmed_currency: string;
  offer_version: string;
  return_url?: string;
};

export type PaymentInitResponse = {
  payment_id: string;
  payment_url: string | null;
  purchase_type: string;
  status: string;
  is_free: boolean;
  final_amount: string;
  currency: string;
  return_url?: string | null;
};
