import type { NavigationReader } from "@/backend/application/navigation/ports/navigation-reader";
import type { NavigationViewModel } from "@/shared/presentation/navigation";

const guest: NavigationViewModel = { authenticated: false, emailVerificationRequired: false, hasSubscription: false, canRenewSubscription: false };

export async function loadNavigation(reader: NavigationReader): Promise<NavigationViewModel> {
  try { return await reader.load(); } catch { return guest; }
}
