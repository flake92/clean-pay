"use server";

import { loadChatwootSupportContext } from "@/application/support/load-chatwoot-context";
import { productionChatwootContextGateway } from "@/backend/integrations/support/chatwoot-context-gateway";

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
