import { bffError, bffJson } from "@/backend/http/bff-response";
import {
  serializePaymentRecord,
  syncPaymentRecordsFromRemnashopTransactions,
} from "@/backend/payments/records";
import { prisma } from "@/backend/database/prisma";
import {
  getAuthorizedRemnashopTokens,
  getRemnashopUserIdFromAccessToken,
} from "@/backend/integrations/remnashop/client";
import {
  getLegacyTransactions,
  getPaymentCapabilities,
} from "@/backend/integrations/remnashop/payment-recovery";
import { BffError } from "@/backend/integrations/remnashop/errors";
import { assertEmailVerificationPolicy, getCurrentUser } from "@/backend/sessions/web-session";
import { syncOnePaymentHistoryPage } from "@/backend/payments/history-sync";
import { assertPaymentUpstreamIdentity } from "@/backend/payments/owner";

export const runtime = "nodejs";

export async function GET() {
  try {
    const user = await getCurrentUser();

    if (!user) {
      return bffError(new BffError("UNAUTHORIZED", 401, "Нужно войти в аккаунт."));
    }
    assertEmailVerificationPolicy(user);

    const { accessToken } = await getAuthorizedRemnashopTokens();
    const upstreamAccountId = getRemnashopUserIdFromAccessToken(accessToken);
    await assertPaymentUpstreamIdentity(user.id, upstreamAccountId);
    const capabilities = await getPaymentCapabilities(accessToken);

    if (capabilities) {
      const pageSize = Math.min(
        100,
        capabilities.transactions.max_page_size,
      );

      await syncOnePaymentHistoryPage({
        userId: user.id,
        upstreamAccountId,
        accessToken,
        pageSize,
      });
    } else {
      const transactions = await getLegacyTransactions(accessToken);
      await syncPaymentRecordsFromRemnashopTransactions({
        userId: user.id,
        upstreamAccountId,
        transactions,
      });
    }

    const records = await prisma.paymentRecord.findMany({
      where: { userId: user.id },
      orderBy: [
        { upstreamCreatedAt: "desc" },
        { paymentId: "desc" },
      ],
      take: 20,
    });

    return bffJson(records.map(serializePaymentRecord));
  } catch (error) {
    return bffError(error);
  }
}
