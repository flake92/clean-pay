import { bffError, bffJson } from "@/backend/http/bff-response";
import { getAuthorizedRemnashopTokens, remnashopRequest } from "@/backend/integrations/remnashop/client";
import { auditedMutation } from "@/backend/observability/mutation-audit";
import type { ReissueResponse } from "@/shared/remnashop/types";

export const runtime = "nodejs";

export async function POST() {
  try {
    const { accessToken, session } = await getAuthorizedRemnashopTokens();

    return bffJson(
      await auditedMutation({
        action: "subscription_reissue",
        userId: session.userId,
        mutate: () => remnashopRequest<ReissueResponse>("/subscription/reissue", {
          method: "POST",
          accessToken,
        }),
      }),
    );
  } catch (error) {
    return bffError(error);
  }
}
