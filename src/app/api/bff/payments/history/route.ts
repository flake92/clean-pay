import { bffError, bffJson } from "@/lib/bff-response";
import { serializePaymentRecord } from "@/lib/payment-records";
import { prisma } from "@/lib/prisma";
import { BffError } from "@/lib/remnashop/errors";
import { getCurrentUser } from "@/lib/session";

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
