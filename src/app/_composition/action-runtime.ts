import { productionAuthCommands } from "@/backend/integrations/auth/auth-commands";
import { productionLinkAccountCommands } from "@/backend/integrations/auth/link-account";
import { productionPasskeyManagementGateway } from "@/backend/integrations/auth/passkey-management-gateway";
import { productionTelegramAccountMergeGateway } from "@/backend/integrations/auth/telegram-account-merge-gateway";
import { productionPaymentMaintenanceRunner } from "@/backend/integrations/payments/payment-maintenance-runner";
import {
  clearReferralAttributionCookie,
  readReferralAttributionCookie,
} from "@/backend/integrations/referral/referral-attribution";
import { productionChatwootIdentityGateway } from "@/backend/integrations/support/chatwoot-identity-gateway";
import {
  ChatwootIdentityCapacityError,
  productionChatwootIdentityRequestGuard,
} from "@/backend/integrations/support/chatwoot-identity-request-guard";

// Server Actions depend only on this framework-level composition root. Adapter
// construction and process-scoped singletons never leak into action modules.
export {
  ChatwootIdentityCapacityError,
  clearReferralAttributionCookie,
  productionAuthCommands,
  productionChatwootIdentityGateway,
  productionChatwootIdentityRequestGuard,
  productionLinkAccountCommands,
  productionPasskeyManagementGateway,
  productionPaymentMaintenanceRunner,
  productionTelegramAccountMergeGateway,
  readReferralAttributionCookie,
};
