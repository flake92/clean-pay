import { NextResponse } from "next/server";

import { getEnv } from "@/backend/config/env";
import { setReferralAttributionCookie } from "@/backend/integrations/referral/referral-attribution";
import { normalizeReferralCode } from "@/shared/domain/referrals";

const registrationDestination = "/register?redirect_to=%2Ftariffs";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ code: string }> },
) {
  const code = normalizeReferralCode((await params).code);
  if (!code) return new NextResponse("Not found", { status: 404 });

  const response = NextResponse.redirect(
    new URL(registrationDestination, getEnv().publicAppUrl),
    303,
  );
  setReferralAttributionCookie(response, code);
  return response;
}
