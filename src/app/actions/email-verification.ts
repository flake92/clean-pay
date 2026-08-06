"use server";

import {
  confirmEmailVerificationCode,
  requestEmailVerificationCode,
  safeReadiness,
} from "@/backend/application/auth/execute-email-verification";
import { productionEmailVerificationCommands } from "@/backend/integrations/auth/email-verification";

export async function requestEmailVerificationCodeAction(input: { email?: string; turnstileToken?: string }) {
  return requestEmailVerificationCode(productionEmailVerificationCommands, input);
}

export async function confirmEmailVerificationCodeAction(input: { email?: string; code: string; turnstileToken?: string }) {
  return confirmEmailVerificationCode(productionEmailVerificationCommands, input);
}

export async function checkAccountReadinessAction() {
  return safeReadiness(productionEmailVerificationCommands);
}
