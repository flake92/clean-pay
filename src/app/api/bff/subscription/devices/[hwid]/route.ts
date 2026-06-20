import { auditLog } from "@/lib/audit";
import { bffError, bffJson } from "@/lib/bff-response";
import { isMockMode, mockDeleteDevice } from "@/lib/mock-bff";
import { getAuthorizedRemnashopTokens, remnashopRequest } from "@/lib/remnashop/client";
import type { DeviceDeleteResponse } from "@/lib/remnashop/types";

export const runtime = "nodejs";

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ hwid: string }> },
) {
  try {
    const { hwid } = await params;
    if (isMockMode()) {
      await auditLog({ action: "device_deleted", metadata: { mode: "mock", hwid } });

      return bffJson(mockDeleteDevice());
    }

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
