import { bffError, bffJson } from "@/lib/bff-response";
import type { ChangeEmailRequest } from "@/lib/remnashop/types";
import { changeEmail } from "@/server/auth/use-cases";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    return bffJson(await changeEmail((await request.json()) as ChangeEmailRequest));
  } catch (error) {
    return bffError(error);
  }
}
