import { NextResponse } from "next/server";

import { productionEmailUnsubscribeGateway } from "@/app/_composition/session-gateways";
import { unsubscribeEmail } from "@/application/notifications/unsubscribe-email";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const noStore = { "cache-control": "no-store" };

// One-click unsubscribe (RFC 8058): mailbox providers POST
// "List-Unsubscribe=One-Click" to the List-Unsubscribe URL without cookies.
// The signed token in the URL is the only authorization.
export async function POST(request: Request) {
  const token = new URL(request.url).searchParams.get("token");
  const result = await unsubscribeEmail(productionEmailUnsubscribeGateway, token);
  if (result.ok) return NextResponse.json({ ok: true }, { headers: noStore });
  return NextResponse.json(
    { ok: false, code: result.code },
    { status: result.code === "INVALID_TOKEN" ? 400 : 503, headers: noStore },
  );
}
