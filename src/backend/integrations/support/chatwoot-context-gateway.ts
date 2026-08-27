import { Prisma } from "@prisma/client";

import type { ChatwootContextGateway } from "@/application/support/ports/chatwoot-context";
import { prisma } from "@/backend/database/prisma";
import { ServiceError } from "@/backend/errors/service-error";
import {
  getAuthorizedRemnashopTokens,
} from "@/backend/integrations/remnashop/client";
import { remnashopValidatedRequest } from "@/backend/integrations/remnashop/api-client-runtime";
import { getCurrentSession } from "@/backend/integrations/sessions/web-session-service";
import type { CurrentSubscriptionResponse } from "@/shared/domain/subscriptions";

type ChatwootAuthorizer = typeof getAuthorizedRemnashopTokens;

export function createProductionChatwootContextGateway(
  authorize: ChatwootAuthorizer = getAuthorizedRemnashopTokens,
): ChatwootContextGateway {
  return {
  async loadActor() {
    const session = await getCurrentSession();

    return session ? { userId: session.userId } : null;
  },

  async loadSubscription(userId) {
    const { accessToken, session } = await authorize();

    if (session.userId !== userId) {
      throw new ServiceError(
        "UNAUTHORIZED",
        401,
        "Current session changed while loading support context",
      );
    }

    const subscription = await remnashopValidatedRequest<CurrentSubscriptionResponse | null>(
      "/subscription/current",
      { accessToken },
    );

    return subscription ? {
      status: subscription.status,
      planName: subscription.plan_name,
      expiresAt: subscription.expire_at,
      isTrial: subscription.is_trial,
    } : null;
  },

  async loadRecentPayments(userId, limit) {
    const [records, syncState] = await prisma.$transaction(
      [
        prisma.paymentRecord.findMany({
          where: { userId },
          orderBy: [{ upstreamCreatedAt: "desc" }, { paymentId: "desc" }],
          take: limit,
          select: {
            status: true,
            finalAmount: true,
            currency: true,
            gatewayType: true,
            planName: true,
            upstreamCreatedAt: true,
          },
        }),
        prisma.paymentHistorySyncState.findUnique({
          where: { userId },
          select: {
            lastSyncedAt: true,
            backfillCompletedAt: true,
          },
        }),
      ],
      { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
    );
    const synchronizedAt = syncState?.lastSyncedAt
      ?? syncState?.backfillCompletedAt
      ?? null;

    return {
      records: records.map((record) => ({
        status: record.status,
        finalAmount: record.finalAmount.toString(),
        currency: record.currency,
        gatewayType: record.gatewayType,
        planName: record.planName,
        createdAt: record.upstreamCreatedAt.toISOString(),
      })),
      synchronizedAt: synchronizedAt?.toISOString() ?? null,
    };
  },
  };
}

export const productionChatwootContextGateway = createProductionChatwootContextGateway();
