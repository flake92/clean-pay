import type { SupportReader } from "@/application/support/ports/support-reader";
import { getEnv } from "@/backend/config/env";

export const productionSupportReader: SupportReader = {
  load() {
    return getEnv().support;
  },
};
