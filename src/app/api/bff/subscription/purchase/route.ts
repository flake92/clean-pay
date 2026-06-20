import { bffError, bffJson } from "@/lib/bff-response";
import { isMockMode, mockPayment } from "@/lib/mock-bff";
import { recordPayment } from "@/lib/payment-records";
import { assertRateLimit } from "@/lib/rate-limit";
import { getAuthorizedRemnashopTokens, remnashopRequest } from "@/lib/remnashop/client";
import type {
  PaymentInitResponse,
  PurchaseRequest,
  SubscriptionOffersResponse,
} from "@/lib/remnashop/types";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as PurchaseRequest;
    if (isMockMode()) {
      await assertRateLimit({
        action: "subscription_purchase",
        limit: 10,
        windowSeconds: 15 * 60,
      });

      return bffJson(mockPayment(body));
    }

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
