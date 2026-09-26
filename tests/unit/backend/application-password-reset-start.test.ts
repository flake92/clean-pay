import { describe, expect, it, vi } from "vitest";

import {
  executePasswordResetStart,
  type PasswordResetStartCommands,
} from "@/application/auth/execute-password-reset-start";
import { AuthGatewayError } from "@/application/auth/ports/auth-commands";

function resetStartCommands(order: string[]) {
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
    rateLimit: vi.fn(async (input: Parameters<PasswordResetStartCommands["rateLimit"]>[0]) => {
      order.push(`rate:${input.action}:${input.email}:${input.limit}:${input.windowSeconds}`);
    }),
    requestPasswordReset: vi.fn(async (email: string) => {
      order.push(`request-reset:${email}`);
    }),
  } satisfies PasswordResetStartCommands;

  return commands;
}

describe("password reset request application flow", () => {
  it("runs the preserved policy and provider request in exact order", async () => {
    const order: string[] = [];
    const commands = resetStartCommands(order);

    await expect(executePasswordResetStart(commands, {
      email: "unknown@example.com",
      turnstileToken: "proof",
    })).resolves.toEqual({ ok: true, kind: "password-reset-requested" });
    expect(order).toEqual([
      "capacity:auth_command",
      "semaphore:turnstile_verify",
      "human:auth_login:proof",
      "rate:password_reset_start:unknown@example.com:5:900",
      "semaphore:remnashop_auth",
      "request-reset:unknown@example.com",
    ]);
    expect(commands.requestPasswordReset).toHaveBeenCalledWith("unknown@example.com");
  });

  it("does not convert a provider failure inside the narrow use case", async () => {
    const order: string[] = [];
    const commands = resetStartCommands(order);
    commands.requestPasswordReset.mockImplementationOnce(async () => {
      order.push("request-reset:failed");
      throw new AuthGatewayError("UPSTREAM_UNAVAILABLE");
    });

    await expect(executePasswordResetStart(commands, {
      email: "user@example.com",
      turnstileToken: null,
    })).rejects.toMatchObject({ code: "UPSTREAM_UNAVAILABLE" });
    expect(order).toEqual([
      "capacity:auth_command",
      "semaphore:turnstile_verify",
      "human:auth_login:null",
      "rate:password_reset_start:user@example.com:5:900",
      "semaphore:remnashop_auth",
      "request-reset:failed",
    ]);
  });
});
