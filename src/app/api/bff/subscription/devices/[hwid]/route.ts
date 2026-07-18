import { bffError, bffJson } from "@/backend/http/bff-response";
import { getAuthorizedRemnashopTokens, remnashopRequest } from "@/backend/integrations/remnashop/client";
import { auditedMutation } from "@/backend/observability/mutation-audit";
import type { DeviceDeleteResponse } from "@/shared/remnashop/types";

export const runtime = "nodejs";

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ hwid: string }> },
) {
  try {
    const { hwid } = await params;
    const { accessToken, session } = await getAuthorizedRemnashopTokens();

    return bffJson(
      await auditedMutation({
        action: "device_delete",
        userId: session.userId,
        mutate: () => remnashopRequest<DeviceDeleteResponse>(
          `/subscription/devices/${encodeURIComponent(hwid)}`,
          {
            method: "DELETE",
            accessToken,
          },
        ),
      }),
    );
  } catch (error) {
    return bffError(error);
  }
}
