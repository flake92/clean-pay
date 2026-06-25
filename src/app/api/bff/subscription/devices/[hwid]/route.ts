import { auditLog } from "@/backend/observability/audit";
import { bffError, bffJson } from "@/backend/http/bff-response";
import { getAuthorizedRemnashopTokens, remnashopRequest } from "@/backend/integrations/remnashop/client";
import type { DeviceDeleteResponse } from "@/shared/remnashop/types";

export const runtime = "nodejs";

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ hwid: string }> },
) {
  try {
    const { hwid } = await params;
    const { accessToken, session } = await getAuthorizedRemnashopTokens();

    await auditLog({ action: "device_deleted", userId: session.userId, metadata: { hwid } });

    return bffJson(
      await remnashopRequest<DeviceDeleteResponse>(
        `/subscription/devices/${encodeURIComponent(hwid)}`,
        {
          method: "DELETE",
          accessToken,
        },
      ),
    );
  } catch (error) {
    return bffError(error);
  }
}
