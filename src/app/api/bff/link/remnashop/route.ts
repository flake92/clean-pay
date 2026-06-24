import { bffError, bffJson } from "@/lib/bff-response";
import type { LoginRequest } from "@/lib/remnashop/types";
import { linkRemnashopAccount } from "@/server/auth/use-cases";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    return bffJson(await linkRemnashopAccount((await request.json()) as LoginRequest));
  } catch (error) {
    return bffError(error);
  }
}
