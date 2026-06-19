import { bffError, bffJson } from "@/lib/bff-response";
import { getAuthorizedRemnashopTokens, remnashopRequest } from "@/lib/remnashop/client";
import type { ExtendRequest } from "@/lib/remnashop/types";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as ExtendRequest;
    const { accessToken } = await getAuthorizedRemnashopTokens();

    return bffJson(
      await remnashopRequest("/subscription/extend", {
        method: "POST",
        accessToken,
        body,
      }),
    );
  } catch (error) {
    return bffError(error);
  }
}
