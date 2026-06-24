import { auditLog } from "@/lib/audit";
import { bffError, bffJson } from "@/lib/bff-response";
import { getAuthorizedRemnashopTokens, remnashopRequest } from "@/lib/remnashop/client";
import type {
  PromocodeActivateRequest,
  PromocodeActivateResponse,
} from "@/lib/remnashop/types";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as PromocodeActivateRequest;
    const { accessToken, session } = await getAuthorizedRemnashopTokens();

    await auditLog({ action: "promocode_activated", userId: session.userId });

    return bffJson(
      await remnashopRequest<PromocodeActivateResponse>("/subscription/promocode", {
        method: "POST",
        accessToken,
        body,
      }),
    );
  } catch (error) {
    return bffError(error);
  }
}
