import type {
  CurrentSubscriptionResponse,
  DevicesResponse,
  SubscriptionOffersResponse,
} from "@/shared/domain/subscriptions";
import type { SupportViewModel } from "@/application/models/support";

export type PaymentHistorySnapshotStatus =
  | "current"
  | "refreshing"
  | "unavailable";

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
  | { status: "provider-session-recovery-required" }
  | {
      status: "error";
      message: string;
      /**
       * Which next step the page should offer. "recover" routes through the
       * cookie-capable provider-session recovery (which can finish an
       * interrupted refresh or Telegram transition, or explain what to do);
       * "retry" is a plain reload for transient upstream trouble.
       */
      recovery?: "retry" | "recover";
    }
  | {
      status: "ready";
      user: CabinetUserViewModel;
      subscription: CurrentSubscriptionResponse | null;
      subscriptionError: string | null;
      offers: SubscriptionOffersResponse | null;
      devices: DevicesResponse | null;
      payments: CabinetPaymentViewModel[];
      paymentHistoryStatus: PaymentHistorySnapshotStatus;
      support: SupportViewModel;
    };
