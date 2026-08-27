"use server";

import { loadChatwootSupportContext } from "@/application/support/load-chatwoot-context";
import { verifyChatwootIdentity } from "@/application/support/verify-chatwoot-identity";
import { productionChatwootContextGateway } from "@/app/_composition/session-gateways";
import {
  ChatwootIdentityCapacityError,
  productionChatwootIdentityGateway,
  productionChatwootIdentityRequestGuard,
} from "@/app/_composition/action-runtime";

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
  if (
    typeof expectedUserId !== "string"
    || expectedUserId.length === 0
    || expectedUserId.length > 255
  ) {
    return "rejected";
  }
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
