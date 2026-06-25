import { bffError, bffJson } from "@/backend/http/bff-response";
import type { LoginRequest } from "@/shared/remnashop/types";
import { linkRemnashopAccount } from "@/backend/auth/remnashop-link";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    return bffJson(await linkRemnashopAccount((await request.json()) as LoginRequest));
  } catch (error) {
    return bffError(error);
  }
}
