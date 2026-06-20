import { bffError, bffJson } from "@/lib/bff-response";
import { isMockMode, mockOffers } from "@/lib/mock-bff";
import { getAuthorizedRemnashopTokens, remnashopRequest } from "@/lib/remnashop/client";

export const runtime = "nodejs";

export async function GET() {
  try {
    if (isMockMode()) {
      return bffJson(mockOffers);
    }

    const { accessToken } = await getAuthorizedRemnashopTokens();

    return bffJson(await remnashopRequest("/subscription/offers", { accessToken }));
  } catch (error) {
    return bffError(error);
  }
}
