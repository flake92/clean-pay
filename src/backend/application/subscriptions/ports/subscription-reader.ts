import type {
  CurrentSubscriptionResponse,
  DevicesResponse,
  SubscriptionOffersResponse,
} from "@/shared/remnashop/types";

export interface SubscriptionReader {
  loadCurrent(): Promise<CurrentSubscriptionResponse | null>;
  loadDevices(): Promise<DevicesResponse>;
  loadOffers(): Promise<SubscriptionOffersResponse>;
}
