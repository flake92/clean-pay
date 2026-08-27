"use server";

import {
  confirmEmailVerificationCode,
  requestEmailVerificationCode,
  safeReadiness,
} from "@/application/auth/execute-email-verification";
import {
  productionAuthProfileGateway,
  productionEmailVerificationCommands,
} from "@/app/_composition/session-gateways";
import { parseEmailActionPayload } from "@/app/actions/runtime-payload";

const malformed = {
  ok: false as const,
  code: "VALIDATION_ERROR",
  message: "Проверьте введённые данные.",
};

export async function requestEmailVerificationCodeAction(input: { email?: string; turnstileToken?: string }) {
  const parsed = parseEmailActionPayload(input);
  return parsed
    ? requestEmailVerificationCode(productionEmailVerificationCommands, parsed)
    : malformed;
}

export async function confirmEmailVerificationCodeAction(input: { email?: string; code: string; turnstileToken?: string }) {
  const parsed = parseEmailActionPayload(input, { codeRequired: true });
  return parsed?.code
    ? confirmEmailVerificationCode(productionEmailVerificationCommands, {
        ...parsed,
        code: parsed.code,
      })
    : malformed;
}

export async function checkAccountReadinessAction() {
  return safeReadiness(productionAuthProfileGateway);
}
