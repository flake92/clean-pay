import {
  PasskeyGatewayError,
  type PasskeyRegistrationActor,
  type PasskeyRegistrationCommands,
} from "@/application/auth/ports/passkey-commands";
import type {
  PasskeyRegistrationOptionsResult,
  PasskeyVerificationResult,
} from "@/application/models/passkey-actions";
import { accountAccessIssue } from "@/shared/domain/account-access-policy";

function failure(
  error: unknown,
  fallback: string,
): { ok: false; code: string; message: string } {
  const candidate = error as { code?: unknown };
  const code = typeof candidate?.code === "string"
    ? candidate.code
    : "INTERNAL_ERROR";
  if (code === "NOT_FOUND" || code === "UNAUTHORIZED") {
    return {
      ok: false,
      code,
      message: "Этот ключ не подходит выбранному аккаунту. Войдите по паролю и при необходимости создайте новый ключ в профиле.",
    };
  }
  return { ok: false, code, message: fallback };
}

function assertRegistrationPolicy(actor: PasskeyRegistrationActor) {
  const issue = actor.assuranceLevel === "FULL"
    ? accountAccessIssue(actor)
    : null;
  if (issue) throw new PasskeyGatewayError(issue);
}

export async function beginPasskeyRegistration(
  commands: PasskeyRegistrationCommands,
): Promise<PasskeyRegistrationOptionsResult> {
  try {
    const actor = await commands.loadRegistrationActor();
    if (!actor) throw new PasskeyGatewayError("UNAUTHORIZED");
    assertRegistrationPolicy(actor);
    const options = await commands.generateRegistrationOptions(actor);
    await commands.storeRegistrationChallenge(
      actor,
      commands.registrationChallenge(options),
    );
    return { ok: true, options };
  } catch (error) {
    return failure(error, "Не удалось подготовить быстрый вход.");
  }
}

export async function verifyPasskeyRegistration(
  commands: PasskeyRegistrationCommands,
  response: unknown,
): Promise<PasskeyVerificationResult> {
  try {
    const actor = await commands.loadRegistrationActor();
    if (!actor) throw new PasskeyGatewayError("UNAUTHORIZED");
    assertRegistrationPolicy(actor);
    const challenge = await commands.consumeRegistrationChallenge(response);
    if (challenge.userId !== actor.userId) {
      throw new PasskeyGatewayError("FORBIDDEN");
    }
    const registration = await commands.verifyRegistration(response, challenge);
    await commands.persistRegistration(actor, response, registration);
    await commands.markRegistrationComplete(actor);
    const upgraded = actor.assuranceLevel !== "FULL";
    if (upgraded) await commands.upgradeRegistrationSession();
    await commands.auditRegistration(actor, registration, upgraded);
    return { ok: true };
  } catch (error) {
    return failure(error, "Не удалось сохранить быстрый вход.");
  }
}
