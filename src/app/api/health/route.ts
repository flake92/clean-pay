import { NextResponse } from "next/server";

export const runtime = "nodejs";

export async function GET() {
  return NextResponse.json({
    status: "ok",
    service: "clean-pay",
    version: process.env.npm_package_version ?? "0.1.0",
  });
}
