import { bffError, bffJson } from "@/lib/bff-response";
import { getAuthorizedRemnashopTokens, remnashopRequest } from "@/lib/remnashop/client";
import type { DevicesResponse } from "@/lib/remnashop/types";

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
