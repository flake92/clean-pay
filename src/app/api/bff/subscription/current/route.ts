import { bffError, bffJson } from "@/backend/http/bff-response";
import { getAuthorizedRemnashopTokens, remnashopRequest } from "@/backend/integrations/remnashop/client";
import { getLiveRemnawaveSubscriptionUrl } from "@/backend/integrations/remnawave/client";
import type { CurrentSubscriptionResponse } from "@/shared/remnashop/types";

export const runtime = "nodejs";

export async function GET() {
  try {
    const { accessToken, session } = await getAuthorizedRemnashopTokens();
    const subscription = await remnashopRequest<CurrentSubscriptionResponse | null>(
      "/subscription/current",
      { accessToken },
    );

    if (!subscription) {
      return bffJson(subscription);
    }

    const liveUrl = await getLiveRemnawaveSubscriptionUrl({
      userRemnaId: subscription.user_remna_id,
      email: session.user.email,
      telegramId: session.user.telegramId,
    });

    return bffJson({
      ...subscription,
      url: liveUrl ?? subscription.url,
    });
  } catch (error) {
    return bffError(error);
  }
}
