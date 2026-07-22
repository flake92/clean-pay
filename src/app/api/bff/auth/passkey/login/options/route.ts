import { bffError, bffJson } from "@/backend/http/bff-response";
import { beginPasskeyLogin } from "@/backend/auth/passkeys";
import { getRequestIp } from "@/backend/security/turnstile";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    return bffJson(await beginPasskeyLogin(getRequestIp(request)));
  } catch (error) {
    return bffError(error);
  }
}
