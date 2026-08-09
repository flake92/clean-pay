import type {
  CabinetPaymentViewModel,
  CabinetUserViewModel,
} from "@/shared/presentation/cabinet";
import type { SupportViewModel } from "@/shared/presentation/support";
import type {
  CurrentSubscriptionResponse,
  DevicesResponse,
  SubscriptionOffersResponse,
} from "@/shared/domain/subscriptions";

export interface CabinetReader {
  loadUser(): Promise<{ id: string; profile: CabinetUserViewModel }>;
  loadSubscription(): Promise<CurrentSubscriptionResponse | null>;
  loadOffers(): Promise<SubscriptionOffersResponse>;
  loadDevices(): Promise<DevicesResponse>;
  loadPayments(userId: string): Promise<{ records: CabinetPaymentViewModel[]; stale: boolean }>;
  loadSupport(): Promise<SupportViewModel>;
}
