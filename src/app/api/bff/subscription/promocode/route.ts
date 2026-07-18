import { bffError, bffJson } from "@/backend/http/bff-response";
import { readBffJsonObject } from "@/backend/http/request-body";
import { getAuthorizedRemnashopTokens, remnashopRequest } from "@/backend/integrations/remnashop/client";
import { auditedMutation } from "@/backend/observability/mutation-audit";
import type {
  PromocodeActivateRequest,
  PromocodeActivateResponse,
} from "@/shared/remnashop/types";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const body = (await readBffJsonObject(request)) as PromocodeActivateRequest;
    const { accessToken, session } = await getAuthorizedRemnashopTokens();

    return bffJson(
      await auditedMutation({
        action: "promocode_activation",
        userId: session.userId,
        mutate: () => remnashopRequest<PromocodeActivateResponse>("/subscription/promocode", {
          method: "POST",
          accessToken,
          body,
        }),
      }),
    );
  } catch (error) {
    return bffError(error);
  }
}
