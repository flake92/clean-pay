import { bffError, bffJson } from "@/lib/bff-response";
import type { ChangePasswordRequest } from "@/lib/remnashop/types";
import { changePassword } from "@/server/auth/use-cases";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    return bffJson(await changePassword((await request.json()) as ChangePasswordRequest));
  } catch (error) {
    return bffError(error);
  }
}
