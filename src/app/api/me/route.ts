import { NextResponse } from "next/server";

import { getCurrentUser } from "@/lib/session";

export const runtime = "nodejs";

export async function GET() {
  const user = await getCurrentUser();

  if (!user) {
    return NextResponse.json({ user: null }, { status: 401 });
  }

  return NextResponse.json({
    user: {
      id: user.id,
      email: user.email,
      telegramId: user.telegramId?.toString() ?? null,
      telegramUsername: user.telegramUsername,
      fullName: user.fullName,
      photoUrl: user.photoUrl,
      displayName: user.displayName,
      emailVerified: user.emailVerified,
      lastLoginAt: user.lastLoginAt,
    },
  });
}
