import { bffError, bffJson } from "@/lib/bff-response";
import { getCurrentAuthProfile } from "@/server/auth/use-cases";

export const runtime = "nodejs";

export async function GET() {
  try {
    return bffJson(await getCurrentAuthProfile());
  } catch (error) {
    return bffError(error);
  }
}
