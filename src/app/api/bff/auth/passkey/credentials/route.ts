import { bffError, bffJson } from "@/backend/http/bff-response";
import { listPasskeys } from "@/backend/auth/passkeys";

export const runtime = "nodejs";

export async function GET() {
  try {
    return bffJson(await listPasskeys());
  } catch (error) {
    return bffError(error);
  }
}
