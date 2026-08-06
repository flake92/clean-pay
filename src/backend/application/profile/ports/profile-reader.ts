import type { ProfileUserViewModel } from "@/shared/presentation/profile";

export interface ProfileReader {
  loadCurrent(): Promise<ProfileUserViewModel>;
}
