import { bffError, bffJson } from "@/backend/http/bff-response";
import {
  serializePaymentRecord,
  syncPaymentRecordsFromRemnashopTransactions,
} from "@/backend/payments/records";
import { prisma } from "@/backend/database/prisma";
import { getAuthorizedRemnashopTokens, remnashopRequest } from "@/backend/integrations/remnashop/client";
import { BffError } from "@/backend/integrations/remnashop/errors";
import type { PaymentTransactionResponse } from "@/shared/remnashop/types";
import { getCurrentUser } from "@/backend/sessions/web-session";

export const runtime = "nodejs";

export async function GET() {
  try {
    const user = await getCurrentUser();

    if (!user) {
      return bffError(new BffError("UNAUTHORIZED", 401, "Нужно войти в аккаунт."));
    }

    const { accessToken } = await getAuthorizedRemnashopTokens();
    const transactions = await remnashopRequest<PaymentTransactionResponse[]>(
      "/subscription/transactions",
      { accessToken },
    );
    await syncPaymentRecordsFromRemnashopTransactions({
      userId: user.id,
      transactions,
    });

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
