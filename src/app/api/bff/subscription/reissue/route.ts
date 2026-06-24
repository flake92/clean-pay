import { auditLog } from "@/lib/audit";
import { bffError, bffJson } from "@/lib/bff-response";
import { getAuthorizedRemnashopTokens, remnashopRequest } from "@/lib/remnashop/client";
import type { ReissueResponse } from "@/lib/remnashop/types";

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
