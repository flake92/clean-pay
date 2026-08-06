import type { NavigationReader } from "@/backend/application/navigation/ports/navigation-reader";
import { getCurrentAuthProfile } from "@/backend/auth/profile";
import { remnashopSubscriptionReader } from "@/backend/integrations/remnashop/subscription-reader";

export const productionNavigationReader: NavigationReader = {
  async load() {
    const { user } = await getCurrentAuthProfile();
    let offers = null;
    try { offers = await remnashopSubscriptionReader.loadOffers(); } catch { /* navigation stays usable */ }
    return {
      authenticated: true,
      emailVerificationRequired: Boolean(user.email && !(user.emailVerified ?? user.is_email_verified)),
      hasSubscription: Boolean(offers?.has_current_subscription),
      canRenewSubscription: Boolean(offers?.plans.some((plan) => plan.recommended_purchase_type.toLowerCase() === "renew")),
    };
  },
};
