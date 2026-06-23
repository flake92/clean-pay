import { bffError, bffJson } from "@/lib/bff-response";
import { isMockMode, mockUser } from "@/lib/mock-bff";
import { getAuthorizedRemnashopTokens, getRemnashopMe } from "@/lib/remnashop/client";

export const runtime = "nodejs";

export async function GET() {
  try {
    if (isMockMode()) {
      return bffJson({ user: mockUser });
    }

    const { accessToken } = await getAuthorizedRemnashopTokens();
    const profile = await getRemnashopMe(accessToken);

    return bffJson({ user: profile });
  } catch (error) {
    return bffError(error);
  }
}
