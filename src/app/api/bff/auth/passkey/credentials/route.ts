import { bffError, bffJson } from "@/lib/bff-response";
import { listPasskeys } from "@/server/auth/passkeys";

export const runtime = "nodejs";

export async function GET() {
  try {
    return bffJson(await listPasskeys());
  } catch (error) {
    return bffError(error);
  }
}
