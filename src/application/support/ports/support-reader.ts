import type { SupportViewModel } from "@/application/models/support";

export interface SupportReader {
  load(): SupportViewModel;
}
