"use server";

import { loadChatwootSupportContext } from "@/application/support/load-chatwoot-context";
import { verifyChatwootIdentity } from "@/application/support/verify-chatwoot-identity";
import { productionChatwootContextGateway } from "@/backend/integrations/support/chatwoot-context-gateway";
import { productionChatwootIdentityGateway } from "@/backend/integrations/support/chatwoot-identity-gateway";
import {
  ChatwootIdentityCapacityError,
  productionChatwootIdentityRequestGuard,
} from "@/backend/integrations/support/chatwoot-identity-request-guard";

export async function loadChatwootSupportContextAction(expectedUserId: string) {
  if (
    typeof expectedUserId !== "string"
    || expectedUserId.length === 0
    || expectedUserId.length > 255
  ) {
    return null;
  }

  return loadChatwootSupportContext(
    productionChatwootContextGateway,
    new Date(),
    expectedUserId,
  );
}

export async function verifyChatwootIdentityAction(expectedUserId: string) {
  try {
    return await productionChatwootIdentityRequestGuard.runAction(() => (
      verifyChatwootIdentity(
        productionChatwootIdentityGateway,
        expectedUserId,
      )
    ));
  } catch (error) {
    if (error instanceof ChatwootIdentityCapacityError) {
      return "pending";
    }

    throw error;
  }
}
