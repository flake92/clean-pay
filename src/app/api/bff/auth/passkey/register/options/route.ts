import { bffError, bffJson } from "@/lib/bff-response";
import { beginPasskeyRegistration } from "@/server/auth/passkeys";

export const runtime = "nodejs";

export async function POST() {
  try {
    return bffJson(await beginPasskeyRegistration());
  } catch (error) {
    return bffError(error);
  }
}
