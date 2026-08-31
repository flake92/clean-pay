import { createProductionAuthCommands } from "@/backend/integrations/auth/auth-commands";
import { createProductionPasskeyManagementGateway } from "@/backend/integrations/auth/passkey-management-gateway";
import {
  productionLinkAccountCommands,
  productionTelegramAccountMergeGateway,
} from "@/app/_composition/account-link-runtime";
import { productionPaymentMaintenanceRunner } from "@/app/_composition/payment-operations-runtime";
import {
  clearReferralAttributionCookie,
  readReferralAttributionCookie,
} from "@/backend/integrations/referral/referral-attribution";
import { createProductionChatwootIdentityGateway } from "@/backend/integrations/support/chatwoot-identity-gateway";
import {
  ChatwootIdentityCapacityError,
  createChatwootIdentityRequestGuard,
} from "@/backend/integrations/support/chatwoot-identity-request-guard";

export const productionAuthCommands = createProductionAuthCommands();
export const productionPasskeyManagementGateway =
  createProductionPasskeyManagementGateway();
export const productionChatwootIdentityRequestGuard =
  createChatwootIdentityRequestGuard();
export const productionChatwootIdentityGateway =
  createProductionChatwootIdentityGateway(
    productionChatwootIdentityRequestGuard,
  );

// Server Actions depend only on this framework-level composition root. Adapter
// construction and process-scoped singletons never leak into action modules.
export {
  ChatwootIdentityCapacityError,
  clearReferralAttributionCookie,
  productionLinkAccountCommands,
  productionPaymentMaintenanceRunner,
  productionTelegramAccountMergeGateway,
  readReferralAttributionCookie,
};
