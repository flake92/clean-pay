import { NextResponse } from "next/server";

import { productionNotificationFeedGateway } from "@/app/_composition/session-gateways";
import { loadNotificationMedia } from "@/application/notifications/notification-feed";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const STATUS: Record<string, number> = { NOT_FOUND: 404, UNAUTHORIZED: 401 };

// Photos and videos of the notification feed; the session decides whose.
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const result = await loadNotificationMedia(productionNotificationFeedGateway, id);
  if (!result.ok) {
    return NextResponse.json(
      { ok: false, code: result.code },
      { status: STATUS[result.code] ?? 503, headers: { "cache-control": "no-store" } },
    );
  }
  return new Response(result.media.body, {
    headers: {
      "cache-control": "private, max-age=86400",
      "content-type": result.media.contentType,
      "x-content-type-options": "nosniff",
    },
  });
}
