import { bffError, bffJson } from "@/lib/bff-response";
import { recordPayment } from "@/lib/payment-records";
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
    const { accessToken, session } = await getAuthorizedRemnashopTokens();
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
