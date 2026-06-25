import { bffError, bffJson } from "@/backend/http/bff-response";
import type { ChangeEmailRequest } from "@/shared/remnashop/types";
import { changeEmail } from "@/backend/auth/email-verification";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    return bffJson(await changeEmail((await request.json()) as ChangeEmailRequest));
  } catch (error) {
    return bffError(error);
  }
}
