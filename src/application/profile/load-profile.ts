import type { ProfileViewModel } from "@/application/models/profile";
import type { AuthProfileGateway } from "@/application/auth/ports/auth-profile";
import { AuthProfileError } from "@/application/auth/ports/auth-profile";
import { resolveAuthProfile } from "@/application/auth/resolve-auth-profile";
import type { EmailReminderPreferenceReader } from "@/application/profile/ports/email-reminder-preferences";

export async function loadProfileViewModel(
  gateway: AuthProfileGateway,
  emailReminders?: EmailReminderPreferenceReader,
): Promise<ProfileViewModel> {
  type ReadyEmailReminderState = Extract<
    ProfileViewModel,
    { status: "ready" }
  >["emailReminders"];
  const unavailableEmailReminders: ReadyEmailReminderState = {
    status: "unavailable",
  };
  const emailReminderStatePromise: Promise<ReadyEmailReminderState> = emailReminders
    ? emailReminders.load()
      .then((preference) => ({ status: "ready" as const, ...preference }))
      .catch(() => unavailableEmailReminders)
    : Promise.resolve(unavailableEmailReminders);

  try {
    const user = await resolveAuthProfile(gateway);
    // Start both independent Remnashop reads together. The optional preference
    // endpoint must neither add another full timeout to the profile request nor
    // make the identity card fail when reminders are temporarily unavailable.
    const emailReminderState = await emailReminderStatePromise;

    return {
      status: "ready",
      user: {
        authType: user.authType,
        email: user.email,
        emailVerified: user.emailVerified,
        pendingEmail: user.pendingEmail,
        telegramId: user.telegramId,
      },
      emailReminders: emailReminderState,
    };
  } catch (error) {
    if (error instanceof AuthProfileError && error.code === "UNAUTHORIZED") {
      return { status: "unauthorized" };
    }
    if (error instanceof AuthProfileError && error.code === "PROVIDER_SESSION_RECOVERY_REQUIRED") {
      return { status: "provider-session-recovery-required" };
    }
    return { status: "error", message: "Не удалось загрузить профиль." };
  }
}
