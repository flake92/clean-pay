import { bffError, bffJson } from "@/backend/http/bff-response";
import type { ChangePasswordRequest } from "@/shared/remnashop/types";
import { changePassword } from "@/backend/auth/password";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    return bffJson(await changePassword((await request.json()) as ChangePasswordRequest));
  } catch (error) {
    return bffError(error);
  }
}
