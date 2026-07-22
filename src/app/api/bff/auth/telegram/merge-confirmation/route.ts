import { cookies } from "next/headers";
import { NextResponse } from "next/server";

import {
  cancelTelegramAccountMerge,
  confirmTelegramAccountMerge,
  getTelegramAccountMergeConfirmation,
  telegramAccountMergeCookieName,
} from "@/backend/auth/telegram-account-merge";
import { getEnv } from "@/backend/config/env";
import { bffError, bffJson } from "@/backend/http/bff-response";
import { BffError } from "@/backend/integrations/remnashop/errors";

export const runtime = "nodejs";

async function confirmationToken() {
  const token = (await cookies()).get(telegramAccountMergeCookieName)?.value;

  if (!token) {
    throw new BffError("NOT_FOUND", 404, "Account merge confirmation was not found.");
  }

  return token;
}

function clearConfirmationCookie(response: NextResponse) {
  const env = getEnv();
  response.cookies.set(telegramAccountMergeCookieName, "", {
    httpOnly: true,
    secure: env.cookieSecure,
    sameSite: env.cookieSameSite,
    path: "/",
    maxAge: 0,
  });
}

export async function GET() {
  try {
    return bffJson(await getTelegramAccountMergeConfirmation(await confirmationToken()));
  } catch (error) {
    return bffError(error);
  }
}

export async function POST() {
  try {
    const result = await confirmTelegramAccountMerge(await confirmationToken());
    const response = bffJson(result);
    clearConfirmationCookie(response);
    return response;
  } catch (error) {
    const response = bffError(error);
    if (
      error instanceof BffError &&
      (error.code === "ACCOUNT_MERGE_SUBSCRIPTIONS_CONFLICT" ||
        error.code === "ACCOUNT_MERGE_REQUIRED")
    ) {
      clearConfirmationCookie(response);
    }
    return response;
  }
}

export async function DELETE() {
  try {
    const result = await cancelTelegramAccountMerge(await confirmationToken());
    const response = bffJson(result);
    clearConfirmationCookie(response);
    return response;
  } catch (error) {
    return bffError(error);
  }
}
