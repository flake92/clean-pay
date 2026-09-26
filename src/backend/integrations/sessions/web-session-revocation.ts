import { cookies } from "next/headers";
import { Prisma } from "@prisma/client";

import { prisma } from "@/backend/database/prisma";
import { revokedWebSessionData } from "@/backend/integrations/sessions/web-session-transitions";

export { revokedWebSessionData } from "@/backend/integrations/sessions/web-session-transitions";

export const sessionCookieNames = {
  access: "clean_pay_access",
  refresh: "clean_pay_refresh",
} as const;

export async function clearWebSessionCookies() {
  const cookieStore = await cookies();
  cookieStore.delete(sessionCookieNames.access);
  cookieStore.delete(sessionCookieNames.refresh);
}

export async function revokeAllWebSessionsForUser(
  userId: string,
  {
    client = prisma,
    now = new Date(),
  }: {
    client?: Pick<Prisma.TransactionClient, "webSession">;
    now?: Date;
  } = {},
) {
  return client.webSession.updateMany({
    where: { userId, revokedAt: null },
    data: revokedWebSessionData(now),
  });
}

export async function revokeWebSessionById(
  sessionId: string,
  userId?: string,
) {
  const now = new Date();

  return prisma.webSession.updateMany({
    where: {
      id: sessionId,
      ...(userId ? { userId } : {}),
      revokedAt: null,
    },
    data: revokedWebSessionData(now),
  });
}
