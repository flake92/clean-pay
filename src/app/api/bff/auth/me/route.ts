import { bffError, bffJson } from "@/lib/bff-response";
import { getAuthorizedRemnashopTokens, getRemnashopMe } from "@/lib/remnashop/client";

export const runtime = "nodejs";

export async function GET() {
  try {
    const { accessToken } = await getAuthorizedRemnashopTokens();
    const profile = await getRemnashopMe(accessToken);

    return bffJson({ user: profile });
  } catch (error) {
    return bffError(error);
  }
}
