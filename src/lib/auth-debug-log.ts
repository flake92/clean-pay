import { logger } from "@/lib/logger";

export function authDebugLog(event: string, metadata: Record<string, unknown> = {}) {
  logger.debug(event, metadata, { category: "auth" });
}
