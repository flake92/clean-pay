import { bffError, bffJson } from "@/lib/bff-response";
import { serializePaymentRecord } from "@/lib/payment-records";
import { prisma } from "@/lib/prisma";
import { getAuthorizedRemnashopTokens, remnashopRequest } from "@/lib/remnashop/client";
import { BffError } from "@/lib/remnashop/errors";
import type { CurrentSubscriptionResponse } from "@/lib/remnashop/types";
import { getCurrentUser } from "@/lib/session";

export const runtime = "nodejs";

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
    } catch {
      subscription = null;
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
