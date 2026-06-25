import { bffError, bffJson } from "@/backend/http/bff-response";
import { getAuthorizedRemnashopTokens, remnashopRequest } from "@/backend/integrations/remnashop/client";
import type { CurrentSubscriptionResponse } from "@/shared/remnashop/types";

export const runtime = "nodejs";

export async function GET() {
  try {
    const { accessToken } = await getAuthorizedRemnashopTokens();

    return bffJson(
      await remnashopRequest<CurrentSubscriptionResponse | null>(
        "/subscription/current",
        { accessToken },
      ),
    );
  } catch (error) {
    return bffError(error);
  }
}
