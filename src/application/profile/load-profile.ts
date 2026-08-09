import type { ProfileReader } from "@/application/profile/ports/profile-reader";
import type { ProfileViewModel } from "@/application/models/profile";

export async function loadProfileViewModel(reader: ProfileReader): Promise<ProfileViewModel> {
  try {
    return { status: "ready", user: await reader.loadCurrent() };
  } catch {
    return { status: "error", message: "Не удалось загрузить профиль." };
  }
}
