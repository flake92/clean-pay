import { bffError, bffJson } from "@/backend/http/bff-response";
import { serializePaymentRecord } from "@/backend/payments/records";
import { prisma } from "@/backend/database/prisma";
import { getAuthorizedRemnashopTokens, remnashopRequest } from "@/backend/integrations/remnashop/client";
import { BffError } from "@/backend/integrations/remnashop/errors";
import type { CurrentSubscriptionResponse } from "@/shared/remnashop/types";
import { getCurrentUser } from "@/backend/sessions/web-session";

export const runtime = "nodejs";

function isSubscriptionNotFound(error: unknown) {
  return error instanceof BffError && error.code === "SUBSCRIPTION_NOT_FOUND";
}

export async function GET(request: Request) {
  try {
    const user = await getCurrentUser();

    if (!user) {
      return bffError(new BffError("UNAUTHORIZED", 401, "Нужно войти в аккаунт."));
    }

    const paymentId = new URL(request.url).searchParams.get("payment_id");
    const record = paymentId
      ? await prisma.paymentRecord.findFirst({
          where: { userId: user.id, paymentId },
        })
      : await prisma.paymentRecord.findFirst({
          where: { userId: user.id },
          orderBy: { createdAt: "desc" },
        });

    let subscription: CurrentSubscriptionResponse | null = null;

    try {
      const { accessToken } = await getAuthorizedRemnashopTokens();
      subscription = await remnashopRequest<CurrentSubscriptionResponse | null>(
        "/subscription/current",
        { accessToken },
      );
    } catch (error) {
      if (!isSubscriptionNotFound(error)) {
        throw error;
      }
    }

    return bffJson({
      payment: record ? serializePaymentRecord(record) : null,
      subscription,
      source: "local_payment_record_and_current_subscription",
    });
  } catch (error) {
    return bffError(error);
  }
}
