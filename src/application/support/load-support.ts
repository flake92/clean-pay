import type { SupportReader } from "@/application/support/ports/support-reader";
import type { SupportViewModel } from "@/application/models/support";

export function loadSupportViewModel(reader: SupportReader): SupportViewModel {
  return reader.load();
}
