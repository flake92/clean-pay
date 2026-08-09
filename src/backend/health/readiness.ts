import {
  getPublicReadiness as getPublicReadinessUseCase,
  resetReadinessStateForTests,
  runDetailedReadiness as runDetailedReadinessUseCase,
  READINESS_DEADLINE_MS,
  READINESS_STALE_AFTER_MS,
} from "@/application/health/readiness";
import { createProductionReadinessGateway } from "@/backend/health/checks";

export { READINESS_DEADLINE_MS, READINESS_STALE_AFTER_MS, resetReadinessStateForTests };

export function runDetailedReadiness() {
  return runDetailedReadinessUseCase(createProductionReadinessGateway());
}

export function getPublicReadiness(now = Date.now()) {
  return getPublicReadinessUseCase(createProductionReadinessGateway(), now);
}
