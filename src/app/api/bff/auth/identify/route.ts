import { bffError, bffJson } from "@/backend/http/bff-response";
import { logger } from "@/backend/observability/logger";
import { prisma } from "@/backend/database/prisma";
import { assertRateLimit } from "@/backend/limits/rate-limit";
import { BffError } from "@/backend/integrations/remnashop/errors";

export const runtime = "nodejs";

function normalizeEmail(value: unknown) {
  return typeof value === "string" ? value.trim().toLowerCase() : "";
}

export async function POST(request: Request) {
  try {
    const rawBody = (await request.json()) as { email?: unknown };
    const email = normalizeEmail(rawBody.email);

    if (!email) {
      throw new BffError("VALIDATION_ERROR", 400, "Email is required");
    }

    try {
      await assertRateLimit({
        action: "auth_identify",
        email,
        limit: 20,
        windowSeconds: 15 * 60,
      });
    } catch (error) {
      logger.warn("auth_identify_rate_limit_unavailable", {
        emailDomain: email.split("@")[1] ?? null,
        message: error instanceof Error ? error.message : String(error),
      }, {
        category: "technical",
        source: "auth.identify",
        message: "Auth identify rate-limit unavailable; continuing",
      });
    }

    const user = await prisma.webUser.findUnique({
      where: { email },
      select: {
        id: true,
        webAuthnCredentials: {
          select: { id: true },
          take: 1,
        },
      },
    });

    return bffJson({
      exists: Boolean(user),
      hasPasskey: Boolean(user?.webAuthnCredentials.length),
    });
  } catch (error) {
    return bffError(error);
  }
}
