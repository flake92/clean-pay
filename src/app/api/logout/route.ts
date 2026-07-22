import { NextResponse } from "next/server";

import { auditLog } from "@/backend/observability/audit";
import { clearWebSession } from "@/backend/sessions/web-session";

export const runtime = "nodejs";

export async function POST() {
  await auditLog({ action: "auth_logout" });
  await clearWebSession();

  return NextResponse.json({ ok: true });
}
