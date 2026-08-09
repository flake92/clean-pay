import type { NavigationReader } from "@/application/navigation/ports/navigation-reader";
import type { NavigationViewModel } from "@/application/models/navigation";
import type { AuthProfileGateway } from "@/application/auth/ports/auth-profile";
import { resolveAuthProfile } from "@/application/auth/resolve-auth-profile";

const guest: NavigationViewModel = { authenticated: false, emailVerificationRequired: false, hasSubscription: false, canRenewSubscription: false };

export async function loadNavigationShell(auth: AuthProfileGateway): Promise<NavigationViewModel> {
  try {
    const session = await auth.loadCurrentSession();
    if (!session) return guest;
    return {
      authenticated: true,
      emailVerificationRequired: Boolean(session.user.email && !session.user.emailVerified),
      hasSubscription: false,
      canRenewSubscription: false,
    };
  } catch {
    return guest;
  }
}

export async function loadNavigation(reader: NavigationReader, auth: AuthProfileGateway): Promise<NavigationViewModel> {
  try {
    const user = await resolveAuthProfile(auth);
    let offers = null;
    try { offers = await reader.loadOffers(); } catch { /* navigation stays usable */ }
    return {
      authenticated: true,
      emailVerificationRequired: Boolean(user.email && !user.emailVerified),
      hasSubscription: Boolean(offers?.has_current_subscription),
      canRenewSubscription: Boolean(offers?.plans.some((plan) => plan.recommended_purchase_type.toLowerCase() === "renew")),
    };
  } catch {
    return guest;
  }
}
