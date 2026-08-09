import type {
  CurrentSubscriptionResponse,
  DevicesResponse,
  SubscriptionOffersResponse,
} from "@/shared/domain/subscriptions";

export interface SubscriptionReader {
  loadCurrent(): Promise<CurrentSubscriptionResponse | null>;
  loadDevices(): Promise<DevicesResponse>;
  loadOffers(): Promise<SubscriptionOffersResponse>;
}
