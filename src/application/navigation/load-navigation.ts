import type {
  NavigationShellViewModel,
  NavigationViewModel,
} from "@/application/models/navigation";
import type { AuthProfileGateway } from "@/application/auth/ports/auth-profile";

const guestNavigation: NavigationViewModel = {
  authenticated: false,
  emailVerificationRequired: false,
};

const guest: NavigationShellViewModel = {
  navigation: guestNavigation,
  supportIdentity: null,
};

export async function loadNavigationShell(
  auth: AuthProfileGateway,
): Promise<NavigationShellViewModel> {
  const session = await auth.loadCurrentSession();
  if (!session) return guest;

  return {
    navigation: {
      authenticated: true,
      emailVerificationRequired: Boolean(session.user.email && !session.user.emailVerified),
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
}
