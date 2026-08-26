import { NextResponse } from "next/server";
import { APP_VERSION } from "@/shared/app-version";

export const runtime = "nodejs";

export async function GET() {
  return NextResponse.json(
    {
      status: "ok",
      service: "clean-pay",
      version: APP_VERSION,
    },
    { headers: { "cache-control": "no-store" } },
  );
}
