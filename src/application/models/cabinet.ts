import type {
  CurrentSubscriptionResponse,
  DevicesResponse,
  SubscriptionOffersResponse,
} from "@/shared/domain/subscriptions";
import type { SupportViewModel } from "@/application/models/support";

type CabinetUserViewModel = {
  email: string | null;
  telegramId?: string | null;
  telegramUsername?: string | null;
  is_email_verified?: boolean;
  emailVerified?: boolean;
};

export type CabinetPaymentViewModel = {
  payment_id: string;
  purchase_type: string;
  status: string;
  final_amount: string;
  currency: string;
  gateway_type: string;
  plan_name: string | null;
  duration_days: number | null;
  is_free: boolean;
  created_at: string;
};

export type CabinetViewModel =
  | { status: "unauthorized" }
  | { status: "error"; message: string }
  | {
      status: "ready";
      user: CabinetUserViewModel;
      subscription: CurrentSubscriptionResponse | null;
      subscriptionError: string | null;
      offers: SubscriptionOffersResponse | null;
      devices: DevicesResponse | null;
      payments: CabinetPaymentViewModel[];
      paymentsWarning: string | null;
      support: SupportViewModel;
    };
