import { describe, expect, it, vi } from "vitest";

import {
  executePasswordResetConfirmation,
  type PasswordResetConfirmationCommands,
} from "@/application/auth/execute-password-reset-confirmation";
import { AuthGatewayError } from "@/application/auth/ports/auth-commands";

function resetConfirmationCommands(order: string[]) {
  const providerSession = { context: { token: "provider-session" } };
  const commands = {
    preflightCapacity: vi.fn(async (action: string) => {
      order.push(`capacity:${action}`);
    }),
    withUpstreamConcurrency: async <T>(action: string, work: () => Promise<T>) => {
      order.push(`semaphore:${action}`);
      return work();
    },
    verifyHuman: vi.fn(async (token: string | null, action: "auth_login") => {
      order.push(`human:${action}:${String(token)}`);
    }),
    rateLimit: vi.fn(async (input: Parameters<PasswordResetConfirmationCommands["rateLimit"]>[0]) => {
      order.push(`rate:${input.action}:${input.email}:${input.limit}:${input.windowSeconds}`);
    }),
    authenticate: vi.fn(async () => {
      order.push("confirm-reset");
      return providerSession;
    }),
    establishSession: vi.fn(async () => {
      order.push("replace-session");
      return { userId: "user-1", emailVerified: false };
    }),
    audit: vi.fn(async () => {
      order.push("audit");
    }),
  } satisfies PasswordResetConfirmationCommands;

  return { commands, providerSession };
}

describe("password reset confirmation application flow", () => {
  it("runs the preserved policy, reset, replacement-session and audit steps in exact order", async () => {
    const order: string[] = [];
    const { commands, providerSession } = resetConfirmationCommands(order);

    await expect(executePasswordResetConfirmation(commands, {
      code: "123456",
      email: "user@example.com",
      newPassword: "new-password",
      turnstileToken: "proof",
    })).resolves.toEqual({
      ok: true,
      kind: "authenticated",
      emailVerified: false,
      verificationRequired: true,
      verificationDeliveryFailed: false,
    });
    expect(order).toEqual([
      "capacity:auth_command",
      "semaphore:turnstile_verify",
      "human:auth_login:proof",
      "rate:password_reset_confirm:user@example.com:5:900",
      "semaphore:remnashop_auth",
      "confirm-reset",
      "semaphore:remnashop_auth",
      "replace-session",
      "audit",
    ]);
    expect(commands.authenticate).toHaveBeenCalledWith({
      operation: "confirm-password-reset",
      email: "user@example.com",
      code: "123456",
      password: "new-password",
    });
    expect(commands.establishSession).toHaveBeenCalledWith(providerSession, {
      replaceExistingSessions: true,
      replacementIdentityEmail: "user@example.com",
    });
    expect(commands.audit).toHaveBeenCalledWith({
      action: "password_reset_success",
      userId: "user-1",
    });
  });

  it("does not replace a session or audit when reset confirmation fails", async () => {
    const order: string[] = [];
    const { commands } = resetConfirmationCommands(order);
    commands.authenticate.mockImplementationOnce(async () => {
      order.push("confirm-reset:failed");
      throw new AuthGatewayError("EMAIL_CODE_INVALID");
    });

    await expect(executePasswordResetConfirmation(commands, {
      code: "654321",
      email: "user@example.com",
      newPassword: "new-password",
      turnstileToken: null,
    })).rejects.toMatchObject({ code: "EMAIL_CODE_INVALID" });
    expect(commands.establishSession).not.toHaveBeenCalled();
    expect(commands.audit).not.toHaveBeenCalled();
  });
});
