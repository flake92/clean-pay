import type { CheckoutReader } from "@/application/payments/ports/checkout";
import { getCurrentAuthProfile } from "@/backend/auth/profile";
import { remnashopSubscriptionReader } from "@/backend/integrations/remnashop/subscription-reader";

export const productionCheckoutReader: CheckoutReader = {
  async loadAccount() {
    try {
      const { user } = await getCurrentAuthProfile();
      return {
        authenticated: true,
        emailVerified: Boolean(user.email && (user.emailVerified ?? user.is_email_verified)),
        accountSyncPending: Boolean(user.accountSyncPending ?? user.account_sync_pending),
      };
    } catch (error) {
      if ((error as { code?: unknown })?.code === "UNAUTHORIZED") return { authenticated: false, emailVerified: false, accountSyncPending: false };
      throw error;
    }
  },
  loadOffers: () => remnashopSubscriptionReader.loadOffers(),
};
