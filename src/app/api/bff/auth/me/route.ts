import { bffError, bffJson } from "@/backend/http/bff-response";
import { getCurrentAuthProfile } from "@/backend/auth/profile";

export const runtime = "nodejs";

export async function GET() {
  try {
    return bffJson(await getCurrentAuthProfile());
  } catch (error) {
    return bffError(error);
  }
}
