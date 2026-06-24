import { auditLog } from "@/lib/audit";
import { bffError, bffJson } from "@/lib/bff-response";
import { getAuthorizedRemnashopTokens, remnashopRequest } from "@/lib/remnashop/client";
import type { DevicesDeleteAllResponse, DevicesResponse } from "@/lib/remnashop/types";

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
