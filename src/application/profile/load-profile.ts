import type { ProfileViewModel } from "@/application/models/profile";
import type { AuthProfileGateway } from "@/application/auth/ports/auth-profile";
import { AuthProfileError } from "@/application/auth/ports/auth-profile";
import { resolveAuthProfile } from "@/application/auth/resolve-auth-profile";

export async function loadProfileViewModel(gateway: AuthProfileGateway): Promise<ProfileViewModel> {
  try {
    const user = await resolveAuthProfile(gateway);
    return {
      status: "ready",
      user: {
        authType: user.authType,
        email: user.email,
        emailVerified: user.emailVerified,
        pendingEmail: user.pendingEmail,
        telegramId: user.telegramId,
      },
    };
  } catch (error) {
    if (error instanceof AuthProfileError && error.code === "UNAUTHORIZED") {
      return { status: "unauthorized" };
    }
    return { status: "error", message: "Не удалось загрузить профиль." };
  }
}
