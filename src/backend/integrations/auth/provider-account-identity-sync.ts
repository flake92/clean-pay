import { ServiceError } from "@/backend/errors/service-error";
import {
  getRemnashopMe,
  getRemnashopUserIdFromAccessToken,
  remnashopRequest,
} from "@/backend/integrations/remnashop/api-client";
import type { CurrentSubscriptionResponse } from "@/backend/integrations/remnashop/contracts";
import {
  assertRemnawaveIdentitySynchronizationConfigured,
  synchronizeRemnawaveUserIdentity,
} from "@/backend/integrations/remnawave/client";
import { markPaymentOwnerChangeUpstreamMutationStarted } from "@/backend/integrations/payments/payment-user-merge-service";
import {
  providerAccountIdentityMismatch,
  type ExpectedProviderAccountIdentity,
} from "@/application/auth/ports/provider-account-identity";

export async function synchronizeProviderAccountIdentity(
  accessToken: string,
  expected: ExpectedProviderAccountIdentity,
  options?: {
    verifiedProfile?: Awaited<ReturnType<typeof getRemnashopMe>>;
    timeoutMs?: number;
  },
) {
  const [profile, subscription] = await Promise.all([
    options?.verifiedProfile ?? getRemnashopMe(accessToken),
    remnashopRequest<CurrentSubscriptionResponse | null>("/subscription/current", {
      accessToken,
      ...(options?.timeoutMs ? { timeoutMs: options.timeoutMs } : {}),
    }),
  ]);
  const telegramId = profile.telegram_id === null ? null : String(profile.telegram_id);
  const mismatch = providerAccountIdentityMismatch({
    accountId: getRemnashopUserIdFromAccessToken(accessToken),
    email: profile.email,
    emailVerified: profile.is_email_verified,
    pendingEmail: profile.pending_email,
    telegramId,
  }, expected);
  if (mismatch) {
    throw new ServiceError(
      "ACCOUNT_MERGE_REQUIRED",
      409,
      "Provider account identity changed during owner transition.",
      { message: `provider_identity_mismatch_${mismatch}` },
    );
  }
  if (!subscription) return { hasSubscription: false, profile };
  if (!profile.email || !telegramId) {
    throw new ServiceError("ACCOUNT_MERGE_REQUIRED", 409, "Merged subscription owner is incomplete.");
  }
  assertRemnawaveIdentitySynchronizationConfigured();
  await synchronizeRemnawaveUserIdentity({
    uuid: subscription.user_remna_id,
    email: profile.email,
    telegramId,
  }, markPaymentOwnerChangeUpstreamMutationStarted);
  return { hasSubscription: true, profile };
}
