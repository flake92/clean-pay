import { auditLog } from "@/lib/audit";
import { bffError, bffJson } from "@/lib/bff-response";
import { recordPayment } from "@/lib/payment-records";
import { assertRateLimit } from "@/lib/rate-limit";
import { getAuthorizedRemnashopTokens, remnashopRequest } from "@/lib/remnashop/client";
import type {
  ExtendRequest,
  PaymentInitResponse,
  SubscriptionOffersResponse,
} from "@/lib/remnashop/types";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as ExtendRequest;
    const { accessToken, session } = await getAuthorizedRemnashopTokens();

    await assertRateLimit({
      action: "subscription_extend",
      email: session.user.email,
      tgId: session.user.telegramId,
      limit: 10,
      windowSeconds: 15 * 60,
    });
    const offers = await remnashopRequest<SubscriptionOffersResponse>(
      "/subscription/offers",
      { accessToken },
    );
    const plan = offers.plans.find(
      (item) => item.recommended_purchase_type === "renew",
    );
    const payment = await remnashopRequest<PaymentInitResponse>(
      "/subscription/extend",
      {
        method: "POST",
        accessToken,
        body,
      },
    );

    await auditLog({
      action: "subscription_extend_created",
      userId: session.userId,
      metadata: { gatewayType: body.gateway_type, durationDays: body.duration_days },
    });

    await recordPayment({
      userId: session.userId,
      gatewayType: body.gateway_type,
      durationDays: body.duration_days,
      plan,
      payment,
    });

    return bffJson(payment);
  } catch (error) {
    return bffError(error);
  }
}
