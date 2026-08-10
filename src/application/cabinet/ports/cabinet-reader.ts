import type { SupportViewModel } from "@/application/models/support";
import type {
  CurrentSubscriptionResponse,
  DevicesResponse,
  SubscriptionOffersResponse,
} from "@/shared/domain/subscriptions";

export interface CabinetReader {
  loadSubscription(): Promise<CurrentSubscriptionResponse | null>;
  loadOffers(): Promise<SubscriptionOffersResponse>;
  loadDevices(): Promise<DevicesResponse>;
  loadSupport(): Promise<SupportViewModel>;
}
