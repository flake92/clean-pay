import { bffError, bffJson } from "@/backend/http/bff-response";
import { readBffJsonObject } from "@/backend/http/request-body";
import { getAuthorizedRemnashopTokens, remnashopRequest } from "@/backend/integrations/remnashop/client";
import { BffError } from "@/backend/integrations/remnashop/errors";
import { auditedMutation } from "@/backend/observability/mutation-audit";
import type {
  PromocodeActivateRequest,
  PromocodeActivateResponse,
} from "@/shared/remnashop/types";

export const runtime = "nodejs";

function readPromocode(body: Record<string, unknown>): PromocodeActivateRequest {
  const code = typeof body.code === "string" ? body.code.trim() : "";

  if (
    code.length === 0 ||
    code.length > 256 ||
    /[\u0000-\u001f\u007f-\u009f]/u.test(code)
  ) {
    throw new BffError(
      "VALIDATION_ERROR",
      400,
      "Promocode must be a bounded printable string",
    );
  }

  return { code };
}

export async function POST(request: Request) {
  try {
    const body = readPromocode(await readBffJsonObject(request));
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
