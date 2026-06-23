import { bffError, bffJson } from "@/lib/bff-response";
import { isMockMode, mockOffers } from "@/lib/mock-bff";
import { remnashopRequest } from "@/lib/remnashop/client";

export const runtime = "nodejs";

export async function GET() {
  try {
    if (isMockMode()) {
      return bffJson(mockOffers.plans);
    }

    return bffJson(await remnashopRequest("/plans/public"));
  } catch (error) {
    return bffError(error);
  }
}
