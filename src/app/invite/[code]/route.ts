import { NextResponse } from "next/server";

import { getEnv } from "@/app/_composition/platform-runtime";
import { setReferralAttributionCookie } from "@/app/_composition/referral-runtime";
import { normalizeReferralCode } from "@/shared/domain/referrals";

const registrationDestination = "/register?redirect_to=%2Ftariffs";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ code: string }> },
) {
  const code = normalizeReferralCode((await params).code);
  if (!code) {
    return new NextResponse("Not found", {
      status: 404,
      headers: { "cache-control": "no-store" },
    });
  }

  const response = NextResponse.redirect(
    new URL(registrationDestination, getEnv().publicAppUrl),
    303,
  );
  response.headers.set("cache-control", "no-store");
  setReferralAttributionCookie(response, code);
  return response;
}
