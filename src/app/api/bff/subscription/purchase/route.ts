import { auditLog } from "@/backend/observability/audit";
import { bffError, bffJson } from "@/backend/http/bff-response";
import { recordPayment } from "@/backend/payments/records";
import { assertRateLimit } from "@/backend/limits/rate-limit";
import { getAuthorizedRemnashopTokens, remnashopRequest } from "@/backend/integrations/remnashop/client";
import type {
  PaymentInitResponse,
  PurchaseRequest,
  SubscriptionOffersResponse,
} from "@/shared/remnashop/types";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as PurchaseRequest;
    const { accessToken, session } = await getAuthorizedRemnashopTokens();

    await assertRateLimit({
      action: "subscription_purchase",
      email: session.user.email,
      tgId: session.user.telegramId,
      limit: 10,
      windowSeconds: 15 * 60,
    });
    const offers = await remnashopRequest<SubscriptionOffersResponse>(
      "/subscription/offers",
      { accessToken },
    );
    const plan = offers.plans.find((item) => item.public_code === body.plan_code);
    const payment = await remnashopRequest<PaymentInitResponse>(
      "/subscription/purchase",
      {
        method: "POST",
        accessToken,
        body,
      },
    );

    await auditLog({
      action: "subscription_purchase_created",
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
