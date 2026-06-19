import { bffError, bffJson } from "@/lib/bff-response";
import { getAuthorizedRemnashopTokens, remnashopRequest } from "@/lib/remnashop/client";
import type { DeviceDeleteResponse } from "@/lib/remnashop/types";

export const runtime = "nodejs";

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ hwid: string }> },
) {
  try {
    const { hwid } = await params;
    const { accessToken } = await getAuthorizedRemnashopTokens();

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
