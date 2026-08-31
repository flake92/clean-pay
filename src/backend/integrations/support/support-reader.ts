import type { SupportReader } from "@/application/support/ports/support-reader";
import { getEnv } from "@/backend/config/env";

export function createProductionSupportReader(): SupportReader {
  return {
    load() {
      return getEnv().support;
    },
  };
}
