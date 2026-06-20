import { auditLog } from "@/lib/audit";
import { bffError, bffJson } from "@/lib/bff-response";
import { isMockMode, mockReissue } from "@/lib/mock-bff";
import { getAuthorizedRemnashopTokens, remnashopRequest } from "@/lib/remnashop/client";
import type { ReissueResponse } from "@/lib/remnashop/types";

export const runtime = "nodejs";

export async function POST() {
  try {
    if (isMockMode()) {
      await auditLog({ action: "subscription_reissued", metadata: { mode: "mock" } });

      return bffJson(mockReissue());
    }

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
