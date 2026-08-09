import type { NavigationViewModel } from "@/application/models/navigation";
import type { AuthProfileGateway } from "@/application/auth/ports/auth-profile";

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
