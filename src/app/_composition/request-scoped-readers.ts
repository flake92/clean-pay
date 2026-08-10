import { cache } from "react";

import { loadCabinetViewModel } from "@/application/cabinet/load-cabinet";
import { createProductionAuthProfileGateway } from "@/backend/integrations/auth/auth-profile-gateway";
import { createProductionCabinetReader } from "@/backend/integrations/cabinet/cabinet-reader";
import { createProductionPaymentHistoryGateway } from "@/backend/integrations/payments/payment-history-reader";
import { productionPaymentMaintenanceRunner } from "@/backend/integrations/payments/payment-maintenance-runner";
import { getAuthorizedRemnashopTokens } from "@/backend/integrations/remnashop/client";
import { createRemnashopSubscriptionReader } from "@/backend/integrations/remnashop/subscription-reader";

// React cache is scoped to one server render/action. It coalesces concurrent
// authorization work without allowing credentials to leak between requests.
const authorizeVerifiedSession = cache(() => getAuthorizedRemnashopTokens());
const authorizeProfileSession = cache(() =>
  getAuthorizedRemnashopTokens({ allowUnverifiedEmail: true }),
);

const subscriptions = createRemnashopSubscriptionReader(authorizeVerifiedSession);

export const requestAuthProfileGateway = createProductionAuthProfileGateway(
  authorizeProfileSession,
);
const requestCabinetReader = createProductionCabinetReader(subscriptions);
const requestPaymentHistoryGateway = createProductionPaymentHistoryGateway(
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
