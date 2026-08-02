import { bffError, bffJson } from "@/backend/http/bff-response";
import { beginPasskeyLogin } from "@/backend/auth/passkeys";
import { getTurnstileToken, verifyTurnstileToken } from "@/backend/security/turnstile";
import { readBffJsonObject } from "@/backend/http/request-body";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const body = await readBffJsonObject(request);
    await verifyTurnstileToken(getTurnstileToken(body), "passkey_login");
    return bffJson(await beginPasskeyLogin());
  } catch (error) {
    return bffError(error);
  }
}
