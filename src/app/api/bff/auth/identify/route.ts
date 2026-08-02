import { bffError, bffJson } from "@/backend/http/bff-response";
import { assertRateLimit } from "@/backend/limits/rate-limit";
import { BffError } from "@/backend/integrations/remnashop/errors";
import { readBffJsonObject } from "@/backend/http/request-body";
import { prisma } from "@/backend/database/prisma";
import { getTurnstileToken, verifyTurnstileToken } from "@/backend/security/turnstile";
import { remnashopIdentifyEmail } from "@/backend/integrations/remnashop/client";

export const runtime = "nodejs";

function normalizeEmail(value: unknown) {
  return typeof value === "string" ? value.trim().toLowerCase() : "";
}

export async function POST(request: Request) {
  try {
    const rawBody = await readBffJsonObject(request);
    const email = normalizeEmail(rawBody.email);

    if (!email) {
      throw new BffError("VALIDATION_ERROR", 400, "Email is required");
    }

    await verifyTurnstileToken(getTurnstileToken(rawBody), "auth_login");

    await assertRateLimit({
      action: "auth_identify",
      email,
      limit: 20,
      windowSeconds: 15 * 60,
    });

    const [upstream, user] = await Promise.all([
      remnashopIdentifyEmail({ email }),
      prisma.webUser.findUnique({
        where: { email },
        select: {
          id: true,
          webAuthnCredentials: { select: { id: true }, take: 1 },
        },
      }),
    ]);

    return bffJson({
      exists: upstream.exists,
      hasPasskey: Boolean(user?.webAuthnCredentials.length),
    });
  } catch (error) {
    return bffError(error);
  }
}
