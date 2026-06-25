import { bffError, bffJson } from "@/backend/http/bff-response";
import { serializePaymentRecord } from "@/backend/payments/records";
import { prisma } from "@/backend/database/prisma";
import { BffError } from "@/backend/integrations/remnashop/errors";
import { getCurrentUser } from "@/backend/sessions/web-session";

export const runtime = "nodejs";

export async function GET() {
  try {
    const user = await getCurrentUser();

    if (!user) {
      return bffError(new BffError("UNAUTHORIZED", 401, "Нужно войти в аккаунт."));
    }

    const records = await prisma.paymentRecord.findMany({
      where: { userId: user.id },
      orderBy: { createdAt: "desc" },
      take: 20,
    });

    return bffJson(records.map(serializePaymentRecord));
  } catch (error) {
    return bffError(error);
  }
}
