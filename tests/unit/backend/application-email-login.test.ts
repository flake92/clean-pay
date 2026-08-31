import { describe, expect, it, vi } from "vitest";

import {
  executeEmailLogin,
  type EmailLoginCommands,
} from "@/application/auth/execute-email-login";
import { AuthGatewayError } from "@/application/auth/ports/auth-commands";

function loginCommands(order: string[]) {
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
    rateLimit: vi.fn(async (input: {
      action: "auth_login";
      email: string;
      limit: number;
      windowSeconds: number;
    }) => {
      order.push(`rate:${input.action}:${input.email}:${input.limit}:${input.windowSeconds}`);
    }),
    authenticate: vi.fn(async () => {
      order.push("authenticate");
      return providerSession;
    }),
    establishSession: vi.fn(async () => {
      order.push("establish-session");
      return { userId: "user-1", emailVerified: false };
    }),
    audit: vi.fn(async () => {
      order.push("audit");
    }),
  } satisfies EmailLoginCommands;

  return { commands, providerSession };
}

describe("email login application flow", () => {
  it("runs the preserved policy, provider, session and audit steps in exact order", async () => {
    const order: string[] = [];
    const { commands, providerSession } = loginCommands(order);

    await expect(executeEmailLogin(commands, {
      email: "user@example.com",
      password: "secret123",
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
      "rate:auth_login:user@example.com:5:900",
      "semaphore:remnashop_auth",
      "authenticate",
      "semaphore:remnashop_auth",
      "establish-session",
      "audit",
    ]);
    expect(commands.authenticate).toHaveBeenCalledWith({
      operation: "login",
      email: "user@example.com",
      password: "secret123",
    });
    expect(commands.establishSession).toHaveBeenCalledWith(providerSession);
    expect(commands.audit).toHaveBeenCalledWith({
      action: "auth_login_success",
      userId: "user-1",
    });
  });

  it("does not create a session or audit when provider authentication fails", async () => {
    const order: string[] = [];
    const { commands } = loginCommands(order);
    commands.authenticate.mockImplementationOnce(async () => {
      order.push("authenticate-failed");
      throw new AuthGatewayError("AUTH_FAILED");
    });

    await expect(executeEmailLogin(commands, {
      email: "user@example.com",
      password: "wrong",
      turnstileToken: null,
    })).rejects.toMatchObject({ code: "AUTH_FAILED" });
    expect(order).toEqual([
      "capacity:auth_command",
      "semaphore:turnstile_verify",
      "human:auth_login:null",
      "rate:auth_login:user@example.com:5:900",
      "semaphore:remnashop_auth",
      "authenticate-failed",
    ]);
    expect(commands.establishSession).not.toHaveBeenCalled();
    expect(commands.audit).not.toHaveBeenCalled();
  });
});
