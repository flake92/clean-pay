import { cookies, headers } from "next/headers";
import type { NextResponse } from "next/server";
import type { WebSessionAssuranceLevel } from "@prisma/client";

import { getEnv } from "@/backend/config/env";
import { sessionCookieNames } from "@/backend/integrations/sessions/web-session-revocation";
import {
  setAccessCookie,
  signAccessToken,
  verifyAccessToken,
} from "@/backend/integrations/sessions/web-session-token";

type WebSessionCookiePolicy = {
  secure: boolean;
  sameSite: ReturnType<typeof getEnv>["cookieSameSite"];
};

type WebSessionCookieIdentity = {
  id: string;
  userId: string;
  accessTokenExpiresAt: Date;
  refreshExpiresAt: Date;
  assuranceLevel: WebSessionAssuranceLevel;
  user: {
    emailVerified: boolean | null;
    telegramId: bigint | number | string | null;
  };
};

export function getWebSessionCookiePolicy(): WebSessionCookiePolicy {
  const env = getEnv();
  return {
    secure: env.cookieSecure,
    sameSite: env.cookieSameSite,
  };
}

export async function openWebSessionCookieTransport() {
  const cookieStore = await cookies();

  return {
    accessToken() {
      return cookieStore.get(sessionCookieNames.access)?.value;
    },
    refreshToken() {
      return cookieStore.get(sessionCookieNames.refresh)?.value;
    },
    deleteAccess() {
      cookieStore.delete(sessionCookieNames.access);
    },
    deleteRefresh() {
      cookieStore.delete(sessionCookieNames.refresh);
    },
    setRefresh(
      refreshToken: string,
      expiresAt: Date,
      policy?: WebSessionCookiePolicy,
    ) {
      cookieStore.set(sessionCookieNames.refresh, refreshToken, {
        httpOnly: true,
        secure: policy?.secure ?? getEnv().cookieSecure,
        sameSite: policy?.sameSite ?? getEnv().cookieSameSite,
        path: "/",
        expires: expiresAt,
      });
    },
  };
}

export async function readWebSessionUserAgent() {
  const requestHeaders = await headers();
  return requestHeaders.get("user-agent");
}

export function setCurrentWebSessionAccessCookie(
  input: Parameters<typeof setAccessCookie>[0],
) {
  return setAccessCookie(input);
}

export function verifyWebSessionAccessToken(accessToken: string) {
  return verifyAccessToken(accessToken);
}

function setResponseWebSessionCookies(
  response: NextResponse,
  session: WebSessionCookieIdentity,
  refreshToken: string,
  policy: WebSessionCookiePolicy,
) {
  const accessToken = signAccessToken({
    sid: session.id,
    uid: session.userId,
    exp: Math.floor(session.accessTokenExpiresAt.getTime() / 1000),
    al: session.assuranceLevel,
    ev: Boolean(session.user.emailVerified),
    tg: Boolean(session.user.telegramId),
  });
  response.cookies.set(sessionCookieNames.access, accessToken, {
    httpOnly: true,
    secure: policy.secure,
    sameSite: policy.sameSite,
    path: "/",
    expires: session.accessTokenExpiresAt,
  });
  response.cookies.set(sessionCookieNames.refresh, refreshToken, {
    httpOnly: true,
    secure: policy.secure,
    sameSite: policy.sameSite,
    path: "/",
    expires: session.refreshExpiresAt,
  });
}

export function setResponseCreatedWebSessionCookies(
  response: NextResponse,
  session: Omit<WebSessionCookieIdentity, "user">,
  user: WebSessionCookieIdentity["user"],
  refreshToken: string,
  policy: WebSessionCookiePolicy,
) {
  setResponseWebSessionCookies(
    response,
    { ...session, user },
    refreshToken,
    policy,
  );
}

export function setDurableCallbackWebSessionCookies(
  response: NextResponse,
  credentials: {
    session: WebSessionCookieIdentity;
    refreshToken: string;
  },
) {
  const policy = getWebSessionCookiePolicy();
  setResponseWebSessionCookies(
    response,
    credentials.session,
    credentials.refreshToken,
    policy,
  );
}
