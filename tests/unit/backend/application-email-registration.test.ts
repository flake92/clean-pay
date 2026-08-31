import { describe, expect, it, vi } from "vitest";

import {
  executeEmailRegistration,
  type EmailRegistrationCommands,
} from "@/application/auth/execute-email-registration";
import { AuthGatewayError } from "@/application/auth/ports/auth-commands";

function registrationCommands(order: string[]) {
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
    rateLimit: vi.fn(async (input: Parameters<EmailRegistrationCommands["rateLimit"]>[0]) => {
      order.push(`rate:${input.action}:${input.email}:${input.limit}:${input.windowSeconds}`);
    }),
    authenticate: vi.fn(async (input: Parameters<EmailRegistrationCommands["authenticate"]>[0]) => {
      order.push(`authenticate:${input.operation}`);
      return providerSession;
    }),
    establishSession: vi.fn(async () => {
      order.push("establish-session");
      return { userId: "user-1", emailVerified: false };
    }),
    requestEmailVerification: vi.fn(async () => {
      order.push("request-verification");
    }),
    audit: vi.fn(async () => {
      order.push("audit");
    }),
  } satisfies EmailRegistrationCommands;

  return { commands, providerSession };
}

describe("email registration application flow", () => {
  it("runs the preserved policy, registration, session, verification and audit steps in exact order", async () => {
    const order: string[] = [];
    const { commands, providerSession } = registrationCommands(order);

    await expect(executeEmailRegistration(commands, {
      email: "user@example.com",
      password: "secret123",
      referralCode: "Friend42",
      turnstileToken: "proof",
    })).resolves.toEqual({
      ok: true,
      kind: "authenticated",
      emailVerified: false,
      registrationFlow: "created",
      verificationRequired: true,
      verificationDeliveryFailed: false,
    });
    expect(order).toEqual([
      "capacity:auth_command",
      "semaphore:turnstile_verify",
      "human:auth_login:proof",
      "rate:auth_register:user@example.com:5:900",
      "semaphore:remnashop_auth",
      "authenticate:register",
      "semaphore:remnashop_auth",
      "establish-session",
      "semaphore:remnashop_auth",
      "request-verification",
      "audit",
    ]);
    expect(commands.authenticate).toHaveBeenCalledWith({
      operation: "register",
      email: "user@example.com",
      password: "secret123",
      referralCode: "Friend42",
    });
    expect(commands.establishSession).toHaveBeenCalledWith(providerSession);
    expect(commands.requestEmailVerification).toHaveBeenCalledWith(
      providerSession,
      "user@example.com",
    );
    expect(commands.audit).toHaveBeenCalledWith({
      action: "auth_register_success",
      userId: "user-1",
      metadata: { flow: "created", verificationDelivery: "sent" },
    });
  });

  it("keeps the exact existing-email fallback and skips verification for a verified session", async () => {
    const order: string[] = [];
    const { commands, providerSession } = registrationCommands(order);
    commands.authenticate
      .mockImplementationOnce(async () => {
        order.push("authenticate:register-rejected");
        throw new AuthGatewayError("EMAIL_ALREADY_EXISTS");
      })
      .mockImplementationOnce(async () => {
        order.push("authenticate:login");
        return providerSession;
      });
    commands.establishSession.mockImplementationOnce(async () => {
      order.push("establish-session");
      return { userId: "user-1", emailVerified: true };
    });

    await expect(executeEmailRegistration(commands, {
      email: "user@example.com",
      password: "secret123",
      turnstileToken: null,
    })).resolves.toEqual({
      ok: true,
      kind: "authenticated",
      emailVerified: true,
      registrationFlow: "existing_email_login",
      verificationRequired: false,
      verificationDeliveryFailed: false,
    });
    expect(commands.authenticate).toHaveBeenNthCalledWith(1, {
      operation: "register",
      email: "user@example.com",
      password: "secret123",
    });
    expect(commands.authenticate).toHaveBeenNthCalledWith(2, {
      operation: "login",
      email: "user@example.com",
      password: "secret123",
    });
    expect(commands.requestEmailVerification).not.toHaveBeenCalled();
    expect(commands.audit).toHaveBeenCalledWith({
      action: "auth_register_success",
      userId: "user-1",
      metadata: { flow: "existing_email_login", verificationDelivery: "not_required" },
    });
  });
});
