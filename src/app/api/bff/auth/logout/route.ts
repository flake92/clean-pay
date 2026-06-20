import { auditLog } from "@/lib/audit";
import { bffError, bffJson } from "@/lib/bff-response";
import { clearWebSession } from "@/lib/session";

export const runtime = "nodejs";

export async function POST() {
  try {
    await auditLog({ action: "auth_logout" });
    await clearWebSession();

    return bffJson({ success: true });
  } catch (error) {
    return bffError(error);
  }
}
