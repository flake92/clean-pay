import { bffError, bffJson } from "@/backend/http/bff-response";
import { beginPasskeyLogin } from "@/backend/auth/passkeys";

export const runtime = "nodejs";

export async function POST() {
  try {
    return bffJson(await beginPasskeyLogin());
  } catch (error) {
    return bffError(error);
  }
}
