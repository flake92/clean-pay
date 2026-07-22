import { logger } from "@/backend/observability/logger";

export function authDebugLog(event: string, metadata: Record<string, unknown> = {}) {
  logger.debug(event, metadata, { category: "auth" });
}
