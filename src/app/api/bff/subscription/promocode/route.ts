import { bffError, bffJson } from "@/lib/bff-response";
import { isMockMode, mockPromocode } from "@/lib/mock-bff";
import { getAuthorizedRemnashopTokens, remnashopRequest } from "@/lib/remnashop/client";
import type {
  PromocodeActivateRequest,
  PromocodeActivateResponse,
} from "@/lib/remnashop/types";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as PromocodeActivateRequest;
    if (isMockMode()) {
      return bffJson(mockPromocode());
    }

    const { accessToken } = await getAuthorizedRemnashopTokens();

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
