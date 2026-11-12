export type GiftStatus = "AVAILABLE" | "ACTIVATED" | "EXPIRED";

/** A gift code bought by the current user, as Remnashop reports it. */
export type Gift = {
  code: string;
  payment_id: string;
  status: GiftStatus;
  plan_name: string;
  duration_days: number;
  traffic_limit: number;
  device_limit: number;
  created_at: string | null;
  expires_at: string | null;
  activated_at: string | null;
};

export type GiftsResponse = {
  gifts: Gift[];
};

export const GIFT_STATUSES: readonly GiftStatus[] = ["AVAILABLE", "ACTIVATED", "EXPIRED"];

export function isGiftStatus(value: string): value is GiftStatus {
  return (GIFT_STATUSES as readonly string[]).includes(value);
}
