import type { SupportViewModel } from "@/shared/presentation/support";

export interface SupportReader {
  load(): SupportViewModel;
}
