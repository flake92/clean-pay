import { createProductionAuthProfileGateway } from "@/backend/integrations/auth/auth-profile-gateway";
import { createProductionEmailVerificationCommands } from "@/backend/integrations/auth/email-verification";
import { createProductionPasskeyCommands } from "@/backend/integrations/auth/passkey-commands";
import { createProductionTelegramCallbackGateway } from "@/backend/integrations/auth/telegram-callback-gateway";
import { createProductionTelegramWebAppGateway } from "@/backend/integrations/auth/telegram-webapp-gateway";
import { createProductionCabinetCommands } from "@/backend/integrations/cabinet/cabinet-commands";
import { createProductionPaymentStatusReader } from "@/backend/integrations/payments/payment-status-reader";
import { createProductionPaymentWorkflowGateway } from "@/backend/integrations/payments/payment-workflow-gateway";
import { createProductionProfileCommands } from "@/backend/integrations/profile/profile-adapter";
import { createEmailReminderPreferenceCommands } from "@/backend/integrations/profile/email-reminder-preferences-adapter";
import { createProductionChatwootContextGateway } from "@/backend/integrations/support/chatwoot-context-gateway";
import {
  getAuthorizedRemnashopTokens,
  recoverRemnashopTelegramSession,
} from "@/app/_composition/telegram-session-recovery";

// Every command-side gateway that can need provider-token restoration is
// constructed here with the same explicitly composed application recovery
// use case. No backend singleton or cold-process registration is involved.
export const productionAuthProfileGateway = createProductionAuthProfileGateway(
  () => getAuthorizedRemnashopTokens({ allowUnverifiedEmail: true }),
);
export const productionEmailVerificationCommands =
  createProductionEmailVerificationCommands(getAuthorizedRemnashopTokens);
export const productionPasskeyCommands =
  createProductionPasskeyCommands(getAuthorizedRemnashopTokens);
export const productionTelegramCallbackGateway =
  createProductionTelegramCallbackGateway(getAuthorizedRemnashopTokens);
export const productionTelegramWebAppGateway =
  createProductionTelegramWebAppGateway(recoverRemnashopTelegramSession);
export const productionCabinetCommands =
  createProductionCabinetCommands(getAuthorizedRemnashopTokens);
export const productionPaymentStatusReader = createProductionPaymentStatusReader(
  undefined,
  () => getAuthorizedRemnashopTokens(),
);
export const productionPaymentWorkflowGateway =
  createProductionPaymentWorkflowGateway(getAuthorizedRemnashopTokens);
export const productionProfileCommands =
  createProductionProfileCommands(getAuthorizedRemnashopTokens);
export const productionEmailReminderPreferenceCommands =
  createEmailReminderPreferenceCommands(() => getAuthorizedRemnashopTokens({
    allowUnverifiedEmail: true,
  }));
export const productionChatwootContextGateway =
  createProductionChatwootContextGateway(getAuthorizedRemnashopTokens);
