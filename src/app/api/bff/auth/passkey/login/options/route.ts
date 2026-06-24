import { bffError, bffJson } from "@/lib/bff-response";
import { beginPasskeyLogin } from "@/server/auth/passkeys";

export const runtime = "nodejs";

export async function POST() {
  try {
    return bffJson(await beginPasskeyLogin());
  } catch (error) {
    return bffError(error);
  }
}
