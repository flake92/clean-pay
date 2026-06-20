import { bffError, bffJson } from "@/lib/bff-response";
import { isMockMode, mockPayment } from "@/lib/mock-bff";
import { recordPayment } from "@/lib/payment-records";
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
    if (isMockMode()) {
      return bffJson(mockPayment(body));
    }

    const { accessToken, session } = await getAuthorizedRemnashopTokens();
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
