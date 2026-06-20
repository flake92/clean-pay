import { bffError, bffJson } from "@/lib/bff-response";
import { clearWebSession } from "@/lib/session";

export const runtime = "nodejs";

export async function POST() {
  try {
    await clearWebSession();

    return bffJson({ success: true });
  } catch (error) {
    return bffError(error);
  }
}
