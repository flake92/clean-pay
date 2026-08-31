import { describe, expect, it, vi } from "vitest";

import {
  executeEmailIdentification,
  type EmailIdentificationCommands,
} from "@/application/auth/execute-email-identification";
import { AuthGatewayError } from "@/application/auth/ports/auth-commands";

function identificationCommands(order: string[]) {
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
    rateLimit: vi.fn(async (input: Parameters<EmailIdentificationCommands["rateLimit"]>[0]) => {
      order.push(`rate:${input.action}:${input.email}:${input.limit}:${input.windowSeconds}`);
    }),
    identifyEmail: vi.fn(async (email: string) => {
      order.push(`identify:${email}`);
      return { exists: true };
    }),
    hasPasskey: vi.fn(async (email: string) => {
      order.push(`passkey:${email}`);
      return true;
    }),
  } satisfies EmailIdentificationCommands;

  return commands;
}

describe("email identification application flow", () => {
  it("runs the preserved policy before starting provider and passkey lookups together", async () => {
    const order: string[] = [];
    const commands = identificationCommands(order);

    await expect(executeEmailIdentification(commands, {
      email: "user@example.com",
      turnstileToken: "proof",
    })).resolves.toEqual({
      ok: true,
      kind: "identified",
      exists: true,
      hasPasskey: true,
    });
    expect(order).toEqual([
      "capacity:auth_command",
      "semaphore:turnstile_verify",
      "human:auth_login:proof",
      "rate:auth_identify:user@example.com:20:900",
      "semaphore:remnashop_auth",
      "identify:user@example.com",
      "passkey:user@example.com",
    ]);
    expect(commands.identifyEmail).toHaveBeenCalledWith("user@example.com");
    expect(commands.hasPasskey).toHaveBeenCalledWith("user@example.com");
  });

  it("keeps provider failures outside the narrow result projection", async () => {
    const order: string[] = [];
    const commands = identificationCommands(order);
    commands.identifyEmail.mockRejectedValueOnce(new AuthGatewayError("UPSTREAM_UNAVAILABLE"));

    await expect(executeEmailIdentification(commands, {
      email: "user@example.com",
      turnstileToken: null,
    })).rejects.toMatchObject({ code: "UPSTREAM_UNAVAILABLE" });
    expect(commands.hasPasskey).toHaveBeenCalledWith("user@example.com");
  });
});
