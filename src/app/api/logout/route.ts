import { NextResponse } from "next/server";

import { clearWebSession } from "@/lib/session";

export const runtime = "nodejs";

export async function POST() {
  await clearWebSession();

  return NextResponse.json({ ok: true });
}
