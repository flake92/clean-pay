import { auditLog } from "@/lib/audit";
import { bffError, bffJson } from "@/lib/bff-response";
import { isMockMode, mockChangePassword } from "@/lib/mock-bff";
import { prisma } from "@/lib/prisma";
import {
  getAuthorizedRemnashopTokens,
  getJwtExpiresAt,
  protectRemnashopToken,
  remnashopChangePassword,
} from "@/lib/remnashop/client";
import type { ChangePasswordRequest } from "@/lib/remnashop/types";

export const runtime = "nodejs";

function addDays(date: Date, days: number) {
  return new Date(date.getTime() + days * 24 * 60 * 60 * 1000);
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as ChangePasswordRequest;
    if (isMockMode()) {
      await auditLog({ action: "password_changed", metadata: { mode: "mock" } });

      return bffJson(mockChangePassword());
    }

    const { accessToken, session } = await getAuthorizedRemnashopTokens();
    const result = await remnashopChangePassword(accessToken, body);

    await prisma.webSession.update({
      where: { id: session.id },
      data: {
        remnashopAccessTokenEncrypted: protectRemnashopToken(
          result.cookies.accessToken,
        ),
        remnashopRefreshTokenEncrypted: protectRemnashopToken(
          result.cookies.refreshToken,
        ),
        remnashopAccessExpiresAt:
          getJwtExpiresAt(result.cookies.accessToken) ?? addDays(new Date(), 1),
        remnashopRefreshExpiresAt: addDays(new Date(), 30),
      },
    });

    await auditLog({ action: "password_changed", userId: session.userId });

    return bffJson(result.data);
  } catch (error) {
    return bffError(error);
  }
}
