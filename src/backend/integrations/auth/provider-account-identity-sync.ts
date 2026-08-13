import { ServiceError } from "@/backend/errors/service-error";
import { getRemnashopMe, remnashopRequest } from "@/backend/integrations/remnashop/client";
import type { CurrentSubscriptionResponse } from "@/backend/integrations/remnashop/contracts";
import { synchronizeRemnawaveUserIdentity } from "@/backend/integrations/remnawave/client";
import { markPaymentOwnerChangeUpstreamMutationStarted } from "@/backend/integrations/payments/payment-user-merge-service";

export async function synchronizeProviderAccountIdentity(accessToken: string) {
  const [profile, subscription] = await Promise.all([
    getRemnashopMe(accessToken),
    remnashopRequest<CurrentSubscriptionResponse | null>("/subscription/current", { accessToken }),
  ]);
  if (!subscription) return false;
  const telegramId = profile.telegram_id === null ? null : String(profile.telegram_id);
  if (!profile.email || !telegramId) {
    throw new ServiceError("ACCOUNT_MERGE_REQUIRED", 409, "Merged subscription owner is incomplete.");
  }
  await markPaymentOwnerChangeUpstreamMutationStarted();
  await synchronizeRemnawaveUserIdentity({
    uuid: subscription.user_remna_id,
    email: profile.email,
    telegramId,
  });
  return true;
}
