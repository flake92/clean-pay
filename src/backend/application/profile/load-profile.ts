import type { ProfileReader } from "@/backend/application/profile/ports/profile-reader";
import type { ProfileViewModel } from "@/shared/presentation/profile";

export async function loadProfileViewModel(reader: ProfileReader): Promise<ProfileViewModel> {
  try {
    return { status: "ready", user: await reader.loadCurrent() };
  } catch {
    return { status: "error", message: "Не удалось загрузить профиль." };
  }
}
