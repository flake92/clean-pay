export type PaymentStatusViewModel = {
  payment: {
    payment_id: string;
    purchase_type: string;
    status: string;
    final_amount: string;
    currency: string;
    gateway_type: string;
    plan_name: string | null;
    created_at: string;
  } | null;
  operation: {
    operation_id: string;
    status: "processing" | "outcome_unknown" | "manual_required" | "succeeded" | "failed" | "retry_ready";
    retry_after_seconds: number | null;
    requires_support: boolean;
    operator_action: string | null;
  } | null;
  subscription: { status: string; plan_name: string; expire_at: string } | null;
};

export type PaymentStatusPageModel =
  | { status: "ready"; data: PaymentStatusViewModel }
  | { status: "error"; message: string };
