import type { ProfileUserViewModel } from "@/application/models/profile";

export interface ProfileReader {
  loadCurrent(): Promise<ProfileUserViewModel>;
}
