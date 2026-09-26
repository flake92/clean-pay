"use server";

import { executeAuthCommand } from "@/application/auth/execute-auth-command";
import type {
  AuthCommandResult,
  AuthExecutionResult,
} from "@/application/models/auth-actions";
import {
  clearReferralAttributionCookie,
  productionAuthCommands,
  readReferralAttributionCookie,
} from "@/app/_composition/action-runtime";

function publicResult(result: AuthExecutionResult): AuthCommandResult {
  if (!result.ok || result.kind !== "authenticated") return result;
  return {
    ok: true,
    kind: "authenticated",
    emailVerified: result.emailVerified,
    verificationRequired: result.verificationRequired,
    verificationDeliveryFailed: result.verificationDeliveryFailed,
  };
}

export async function executeAuthAction(command: unknown): Promise<AuthCommandResult> {
  const input = command && typeof command === "object" && !Array.isArray(command)
    ? command as Record<string, unknown>
    : null;
  const kind = typeof input?.kind === "string" ? input.kind : null;

  if (kind !== "register") {
    const result = await executeAuthCommand(productionAuthCommands, command);
    if (
      (kind === "login" || kind === "confirm-password-reset")
      && result.ok
      && result.kind === "authenticated"
    ) {
      // The browser reached a terminal existing-account flow. Any pending
      // invite attribution is inapplicable and must not affect a later user.
      await clearReferralAttributionCookie();
    }
    return publicResult(result);
  }

  // Referral attribution is accepted only from the signed HttpOnly cookie.
  // A caller-supplied command field is deliberately discarded here.
  const referralCode = await readReferralAttributionCookie();
  const registration = { ...input };
  delete registration.referralCode;
  const result = await executeAuthCommand(productionAuthCommands, {
    ...registration,
    ...(referralCode ? { referralCode } : {}),
  });

  if (
    result.ok
    && result.kind === "authenticated"
    && result.registrationFlow
  ) {
    // A created account consumed the attribution. A successful fallback login
    // discards it as inapplicable so it cannot affect a later account.
    await clearReferralAttributionCookie();
  }

  return publicResult(result);
}
