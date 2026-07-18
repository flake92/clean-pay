import { bffError, bffJson } from "@/backend/http/bff-response";
import { getAuthorizedRemnashopTokens, remnashopRequest } from "@/backend/integrations/remnashop/client";
import { auditedMutation } from "@/backend/observability/mutation-audit";
import type { DevicesDeleteAllResponse, DevicesResponse } from "@/shared/remnashop/types";

export const runtime = "nodejs";

export async function GET() {
  try {
    const { accessToken } = await getAuthorizedRemnashopTokens();

    return bffJson(
      await remnashopRequest<DevicesResponse>("/subscription/devices", { accessToken }),
    );
  } catch (error) {
    return bffError(error);
  }
}

export async function DELETE() {
  try {
    const { accessToken, session } = await getAuthorizedRemnashopTokens();

    return bffJson(
      await auditedMutation({
        action: "devices_delete_all",
        userId: session.userId,
        mutate: () => remnashopRequest<DevicesDeleteAllResponse>("/subscription/devices", {
          method: "DELETE",
          accessToken,
        }),
      }),
    );
  } catch (error) {
    return bffError(error);
  }
}
