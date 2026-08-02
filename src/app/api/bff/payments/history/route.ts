import { bffError, bffJson } from "@/backend/http/bff-response";
import {
  serializePaymentRecord,
  syncExactPaymentRecordFromRemnashop,
  syncPaymentRecordsFromRemnashopTransactions,
} from "@/backend/payments/records";
import { prisma } from "@/backend/database/prisma";
import {
  getAuthorizedRemnashopTokens,
  getRemnashopUserIdFromAccessToken,
} from "@/backend/integrations/remnashop/client";
import {
  getExactTransaction,
  getLegacyTransactions,
  getPaymentCapabilities,
} from "@/backend/integrations/remnashop/payment-recovery";
import { BffError } from "@/backend/integrations/remnashop/errors";
import { assertEmailVerificationPolicy, getCurrentUser } from "@/backend/sessions/web-session";
import { syncOnePaymentHistoryPage } from "@/backend/payments/history-sync";
import { assertPaymentUpstreamIdentity } from "@/backend/payments/owner";
import { logger } from "@/backend/observability/logger";

export const runtime = "nodejs";

export async function GET() {
  try {
    const user = await getCurrentUser();

    if (!user) {
      return bffError(new BffError("UNAUTHORIZED", 401, "Нужно войти в аккаунт."));
    }
    assertEmailVerificationPolicy(user);

    let stale = false;

    try {
      const { accessToken } = await getAuthorizedRemnashopTokens();
      const upstreamAccountId = getRemnashopUserIdFromAccessToken(accessToken);
      await assertPaymentUpstreamIdentity(user.id, upstreamAccountId);
      const capabilities = await getPaymentCapabilities(accessToken);

      if (capabilities) {
        const pending = await prisma.paymentRecord.findMany({
          where: {
            userId: user.id,
            status: { in: ["PENDING", "UNKNOWN"] },
          },
          orderBy: { createdAt: "desc" },
          select: { paymentId: true },
          take: 5,
        });

        for (const [index, record] of pending.entries()) {
          try {
            const exact = await getExactTransaction({
              accessToken,
              paymentId: record.paymentId,
            });
            if (exact) {
              await syncExactPaymentRecordFromRemnashop({
                userId: user.id,
                upstreamAccountId,
                transaction: exact,
              });
            }
          } catch (error) {
            stale = true;
            logger.warn("payment_history_exact_sync_failed", {
              index,
              errorName: error instanceof Error ? error.name : "UnknownError",
            }, {
              category: "upstream",
              source: "payments.history",
              message: "Exact payment-history sync failed; continuing with page sync",
            });
          }
        }

        await syncOnePaymentHistoryPage({
          userId: user.id,
          upstreamAccountId,
          accessToken,
          pageSize: Math.min(100, capabilities.transactions.max_page_size),
        });
      } else {
        const transactions = await getLegacyTransactions(accessToken);
        await syncPaymentRecordsFromRemnashopTransactions({
          userId: user.id,
          upstreamAccountId,
          transactions,
        });
      }
    } catch (error) {
      stale = true;
      logger.warn("payment_history_sync_degraded", {
        errorName: error instanceof Error ? error.name : "UnknownError",
      }, {
        category: "upstream",
        source: "payments.history",
        message: "Serving owner-bound cached payment history after sync failure",
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

    return bffJson(
      records.map(serializePaymentRecord),
      stale ? { headers: { "x-clean-pay-history-stale": "1" } } : undefined,
    );
  } catch (error) {
    return bffError(error);
  }
}
