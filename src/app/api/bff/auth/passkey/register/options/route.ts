import { bffError, bffJson } from "@/backend/http/bff-response";
import { beginPasskeyRegistration } from "@/backend/auth/passkeys";

export const runtime = "nodejs";

export async function POST() {
  try {
    return bffJson(await beginPasskeyRegistration());
  } catch (error) {
    return bffError(error);
  }
}
