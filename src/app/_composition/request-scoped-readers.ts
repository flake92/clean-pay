import { cache } from "react";

import { loadCabinetViewModel } from "@/application/cabinet/load-cabinet";
import { loadReferralProgram } from "@/application/referral/load-referral-program";
import { getEnv } from "@/backend/config/env";
import { createProductionAuthProfileGateway } from "@/backend/integrations/auth/auth-profile-gateway";
import { createProductionLinkAccountReader } from "@/backend/integrations/auth/link-account";
import { createProductionPasskeyManagementGateway } from "@/backend/integrations/auth/passkey-management-gateway";
import { createProductionCabinetReader } from "@/backend/integrations/cabinet/cabinet-reader";
import { createProductionCheckoutReader } from "@/backend/integrations/payments/checkout-reader";
import { createProductionPaymentHistoryGateway } from "@/backend/integrations/payments/payment-history-reader";
import { productionPaymentMaintenanceRunner } from "@/backend/integrations/payments/payment-maintenance-runner";
import { createProductionPaymentStatusReader } from "@/backend/integrations/payments/payment-status-reader";
import { createReferralProgramReader } from "@/backend/integrations/referral/referral-program-reader";
import { getAuthorizedRemnashopTokens } from "@/backend/integrations/remnashop/client";
import { createRemnashopSubscriptionCatalog } from "@/backend/integrations/remnashop/subscription-catalog";
import { getCurrentSessionReadOnly } from "@/backend/integrations/sessions/web-session-service";
import { createRemnashopSubscriptionReader } from "@/backend/integrations/remnashop/subscription-reader";

// React cache is scoped to one server render/action. It coalesces concurrent
// authorization work without allowing credentials to leak between requests.
const skipAccessCookieRefresh = async () => null;
const skipVerifiedEmailPersistence = async () => undefined;
const readCurrentUserOnly = async () =>
  (await getCurrentSessionReadOnly())?.user ?? null;

const authorizeVerifiedSession = cache(() => getAuthorizedRemnashopTokens({
  readSession: getCurrentSessionReadOnly,
  refreshAccessCookie: skipAccessCookieRefresh,
}));
const authorizeProfileSession = cache(() =>
  getAuthorizedRemnashopTokens({
    allowUnverifiedEmail: true,
    readSession: getCurrentSessionReadOnly,
    refreshAccessCookie: skipAccessCookieRefresh,
  }),
);

const subscriptions = createRemnashopSubscriptionReader(authorizeVerifiedSession);
export const requestSubscriptionCatalog =
  createRemnashopSubscriptionCatalog(authorizeVerifiedSession);
export const requestReferralProgramReader = createReferralProgramReader(
  authorizeVerifiedSession,
  getEnv().publicAppUrl,
);

export const requestAuthProfileGateway = createProductionAuthProfileGateway(
  authorizeProfileSession,
  getCurrentSessionReadOnly,
  skipAccessCookieRefresh,
  skipVerifiedEmailPersistence,
  false,
);
export const requestLinkAccountReader = createProductionLinkAccountReader(
  getCurrentSessionReadOnly,
);
export const requestPasskeyManagementGateway =
  createProductionPasskeyManagementGateway(getCurrentSessionReadOnly);
const requestCabinetReader = createProductionCabinetReader(subscriptions);
export const requestCheckoutReader = createProductionCheckoutReader(subscriptions);
const requestPaymentHistoryGateway = createProductionPaymentHistoryGateway(
  authorizeVerifiedSession,
);
export const requestPaymentStatusReader = createProductionPaymentStatusReader(
  readCurrentUserOnly,
  authorizeVerifiedSession,
);

export const loadRequestCabinetViewModel = cache(() =>
  loadCabinetViewModel(
    requestCabinetReader,
    requestAuthProfileGateway,
    requestPaymentHistoryGateway,
    productionPaymentMaintenanceRunner,
  ),
);
export const loadRequestReferralProgram = cache(() =>
  loadReferralProgram(requestReferralProgramReader),
);
