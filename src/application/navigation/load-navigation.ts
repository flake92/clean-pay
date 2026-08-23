import type {
  NavigationShellViewModel,
  NavigationViewModel,
} from "@/application/models/navigation";
import type { AuthProfileGateway } from "@/application/auth/ports/auth-profile";
import type { SubscriptionCatalog } from "@/application/subscriptions/ports/subscription-catalog";

const guestNavigation: NavigationViewModel = {
  authenticated: false,
  emailVerificationRequired: false,
  hasSubscription: false,
  canRenewSubscription: false,
};

const guest: NavigationShellViewModel = {
  navigation: guestNavigation,
  supportIdentity: null,
};

export async function loadNavigationShell(
  auth: AuthProfileGateway,
  subscriptions: SubscriptionCatalog,
): Promise<NavigationShellViewModel> {
  try {
    const session = await auth.loadCurrentSession();
    if (!session) return guest;

    let hasSubscription = false;
    let canRenewSubscription = false;
    try {
      const offers = await subscriptions.loadOffers();
      hasSubscription = offers.has_current_subscription;
      canRenewSubscription = offers.plans.some(
        (plan) => plan.recommended_purchase_type.toLowerCase() === "renew",
      );
    } catch {
      // Authentication, account actions and support must remain available
      // while the optional subscription menu state is temporarily unavailable.
    }

    return {
      navigation: {
        authenticated: true,
        emailVerificationRequired: Boolean(session.user.email && !session.user.emailVerified),
        hasSubscription,
        canRenewSubscription,
      },
      supportIdentity: {
        userId: session.userId,
        email: session.user.email,
        emailVerified: session.user.emailVerified,
        telegramId: session.user.telegramId,
        telegramUsername: session.user.telegramUsername,
        fullName: session.user.fullName,
        displayName: session.user.displayName,
      },
    };
  } catch {
    return guest;
  }
}
