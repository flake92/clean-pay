import { auditLog } from "@/backend/observability/audit";
import { bffError, bffJson } from "@/backend/http/bff-response";
import { getAuthorizedRemnashopTokens, remnashopRequest } from "@/backend/integrations/remnashop/client";
import type { ReissueResponse } from "@/shared/remnashop/types";

export const runtime = "nodejs";

export async function POST() {
  try {
    const { accessToken, session } = await getAuthorizedRemnashopTokens();

    await auditLog({ action: "subscription_reissued", userId: session.userId });

    return bffJson(
      await remnashopRequest<ReissueResponse>("/subscription/reissue", {
        method: "POST",
        accessToken,
      }),
    );
  } catch (error) {
    return bffError(error);
  }
}
