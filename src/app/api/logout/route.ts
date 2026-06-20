import { NextResponse } from "next/server";

import { auditLog } from "@/lib/audit";
import { clearWebSession } from "@/lib/session";

export const runtime = "nodejs";

export async function POST() {
  await auditLog({ action: "auth_logout" });
  await clearWebSession();

  return NextResponse.json({ ok: true });
}
