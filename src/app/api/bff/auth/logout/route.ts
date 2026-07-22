import { auditLog } from "@/backend/observability/audit";
import { bffError, bffJson } from "@/backend/http/bff-response";
import { clearWebSession } from "@/backend/sessions/web-session";

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
