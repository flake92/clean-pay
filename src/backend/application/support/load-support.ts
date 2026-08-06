import type { SupportReader } from "@/backend/application/support/ports/support-reader";
import type { SupportViewModel } from "@/shared/presentation/support";

export function loadSupportViewModel(reader: SupportReader): SupportViewModel {
  return reader.load();
}
