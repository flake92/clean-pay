import {
  getPublicReadiness as getPublicReadinessUseCase,
  runDetailedReadiness as runDetailedReadinessUseCase,
} from "@/application/health/readiness";
import { createProductionReadinessGateway } from "@/backend/health/checks";

export function runDetailedReadiness() {
  return runDetailedReadinessUseCase(createProductionReadinessGateway());
}

export function getPublicReadiness(now = Date.now()) {
  return getPublicReadinessUseCase(createProductionReadinessGateway(), now);
}
