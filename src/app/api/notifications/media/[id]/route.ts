import { NextResponse } from "next/server";

import { productionNotificationFeedGateway } from "@/app/_composition/session-gateways";
import { loadNotificationMedia } from "@/application/notifications/notification-feed";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const STATUS: Record<string, number> = { NOT_FOUND: 404, UNAUTHORIZED: 401 };

function parseRange(header: string, size: number) {
  const match = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
  if (!match || (!match[1] && !match[2])) return null;
  const start = match[1] ? Number(match[1]) : Math.max(size - Number(match[2]), 0);
  const end = match[1] && match[2] ? Math.min(Number(match[2]), size - 1) : size - 1;
  return start <= end ? { start, end } : "unsatisfiable";
}

// Photos and videos of the notification feed; the session decides whose.
// Safari plays a video only from a server that answers byte ranges.
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const result = await loadNotificationMedia(productionNotificationFeedGateway, id);
  if (!result.ok) {
    return NextResponse.json(
      { ok: false, code: result.code },
      { status: STATUS[result.code] ?? 503, headers: { "cache-control": "no-store" } },
    );
  }
  const headers = {
    "accept-ranges": "bytes",
    "cache-control": "private, max-age=86400",
    "content-type": result.media.contentType,
    "x-content-type-options": "nosniff",
  };
  const rangeHeader = request.headers.get("range");
  if (!rangeHeader) return new Response(result.media.body, { headers });

  // Telegram limits these files to 20 MB, so one is safe to hold in memory.
  const bytes = await new Response(result.media.body).arrayBuffer();
  const range = parseRange(rangeHeader, bytes.byteLength);
  if (range === "unsatisfiable") {
    return new Response(null, {
      status: 416,
      headers: { ...headers, "content-range": `bytes */${bytes.byteLength}` },
    });
  }
  if (!range) return new Response(bytes, { headers });
  return new Response(bytes.slice(range.start, range.end + 1), {
    status: 206,
    headers: {
      ...headers,
      "content-length": String(range.end - range.start + 1),
      "content-range": `bytes ${range.start}-${range.end}/${bytes.byteLength}`,
    },
  });
}
