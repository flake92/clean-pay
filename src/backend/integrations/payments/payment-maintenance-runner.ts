import type {
  PaymentMaintenanceRunner,
} from "@/application/payments/ports/payment-maintenance";
import { continuePaymentHistoryBackfills } from "@/backend/integrations/payments/payment-history-sync-service";
import { reconcileUnknownPayments } from "@/backend/integrations/payments/payment-reconciliation-service";

export const productionPaymentMaintenanceRunner: PaymentMaintenanceRunner = {
  reconcile: reconcileUnknownPayments,
  continueHistory: continuePaymentHistoryBackfills,
};
