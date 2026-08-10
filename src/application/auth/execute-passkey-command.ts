import {
  PasskeyGatewayError,
  type PasskeyCommands,
  type PasskeyRegistrationActor,
} from "@/application/auth/ports/passkey-commands";
import type {
  PasskeyLoginOptionsResult,
  PasskeyRegistrationOptionsResult,
  PasskeyVerificationResult,
} from "@/application/models/passkey-actions";
import { accountAccessIssue } from "@/shared/domain/account-access-policy";

function failure(error: unknown, fallback: string): { ok: false; code: string; message: string } {
  const candidate = error as { code?: unknown };
  const code = typeof candidate?.code === "string" ? candidate.code : "INTERNAL_ERROR";
  if (code === "NOT_FOUND" || code === "UNAUTHORIZED") {
    return { ok: false, code, message: "Этот ключ не подходит выбранному аккаунту. Войдите по паролю и при необходимости создайте новый ключ в профиле." };
  }
  return { ok: false, code, message: fallback };
}

function assertRegistrationPolicy(actor: PasskeyRegistrationActor) {
  const issue = actor.assuranceLevel === "FULL" ? accountAccessIssue(actor) : null;
  if (issue) throw new PasskeyGatewayError(issue);
}

export async function beginPasskeyLogin(commands: PasskeyCommands, input: { email: string; turnstileToken?: string }): Promise<PasskeyLoginOptionsResult> {
  try {
    await commands.verifyHuman(input.turnstileToken ?? null);
    const email = input.email.trim().toLowerCase();
    if (!email) throw new PasskeyGatewayError("VALIDATION_ERROR");
    await commands.assertLoginOptionsRateLimit(email);
    const options = await commands.withLoginOptionsConcurrency(async () => {
      const account = await commands.findLoginAccount(email);
      if (!account?.credentials.length) throw new PasskeyGatewayError("NOT_FOUND");
      const generated = await commands.generateLoginOptions(account);
      await commands.storeLoginChallenge(account, commands.loginChallenge(generated));
      return generated;
    });
    return { ok: true, options };
  } catch (error) {
    return failure(error, "Не удалось начать быстрый вход.");
  }
}

export async function verifyPasskeyLogin(commands: PasskeyCommands, response: unknown): Promise<PasskeyVerificationResult> {
  try {
    await commands.assertLoginVerificationRateLimit();
    const challenge = await commands.consumeLoginChallenge(response);
    const credential = await commands.findCredential(response);
    if (!credential) throw new PasskeyGatewayError("UNAUTHORIZED");
    if (!challenge.userId || challenge.userId !== credential.userId) throw new PasskeyGatewayError("UNAUTHORIZED");
    const verification = await commands.verifyAuthentication(response, challenge, credential);
    await commands.recordAuthentication(credential, verification);
    const session = await commands.createAuthenticatedSession(credential.userId);
    await commands.auditLogin(credential, session.id);
    return { ok: true };
  } catch (error) {
    return failure(error, "Быстрый вход не подошёл. Войдите по паролю.");
  }
}

export async function beginPasskeyRegistration(commands: PasskeyCommands): Promise<PasskeyRegistrationOptionsResult> {
  try {
    const actor = await commands.loadRegistrationActor();
    if (!actor) throw new PasskeyGatewayError("UNAUTHORIZED");
    assertRegistrationPolicy(actor);
    const options = await commands.generateRegistrationOptions(actor);
    await commands.storeRegistrationChallenge(actor, commands.registrationChallenge(options));
    return { ok: true, options };
  } catch (error) {
    return failure(error, "Не удалось подготовить быстрый вход.");
  }
}

export async function verifyPasskeyRegistration(commands: PasskeyCommands, response: unknown): Promise<PasskeyVerificationResult> {
  try {
    const actor = await commands.loadRegistrationActor();
    if (!actor) throw new PasskeyGatewayError("UNAUTHORIZED");
    assertRegistrationPolicy(actor);
    const challenge = await commands.consumeRegistrationChallenge(response);
    if (challenge.userId !== actor.userId) throw new PasskeyGatewayError("FORBIDDEN");
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
