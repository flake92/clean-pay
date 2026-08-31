import {
  createProductionLinkAccountCommands,
  createProductionLinkAccountReader,
} from "@/backend/integrations/auth/link-account";
import { createProductionTelegramAccountMergeGateway } from "@/backend/integrations/auth/telegram-account-merge-gateway";

export const productionTelegramAccountMergeGateway =
  createProductionTelegramAccountMergeGateway();
export const productionLinkAccountReader = createProductionLinkAccountReader(
  productionTelegramAccountMergeGateway,
);
export const productionLinkAccountCommands =
  createProductionLinkAccountCommands();
