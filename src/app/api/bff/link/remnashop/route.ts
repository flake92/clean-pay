import { bffError, bffJson } from "@/backend/http/bff-response";
import type { LoginRequest } from "@/shared/remnashop/types";
import { linkRemnashopAccount } from "@/backend/auth/remnashop-link";
import { readBffJsonObject } from "@/backend/http/request-body";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    return bffJson(await linkRemnashopAccount((await readBffJsonObject(request)) as LoginRequest));
  } catch (error) {
    return bffError(error);
  }
}
