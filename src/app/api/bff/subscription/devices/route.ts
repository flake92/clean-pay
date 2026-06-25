import { auditLog } from "@/backend/observability/audit";
import { bffError, bffJson } from "@/backend/http/bff-response";
import { getAuthorizedRemnashopTokens, remnashopRequest } from "@/backend/integrations/remnashop/client";
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

    await auditLog({ action: "devices_deleted_all", userId: session.userId });

    return bffJson(
      await remnashopRequest<DevicesDeleteAllResponse>("/subscription/devices", {
        method: "DELETE",
        accessToken,
      }),
    );
  } catch (error) {
    return bffError(error);
  }
}
