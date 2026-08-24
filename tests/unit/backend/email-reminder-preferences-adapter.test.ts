import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  auditedMutation: vi.fn(),
  rateLimit: vi.fn(),
}));

vi.mock("@/backend/limits/rate-limit", () => ({
  assertRateLimit: mocks.rateLimit,
}));
vi.mock("@/backend/observability/mutation-audit", () => ({
  auditedMutation: mocks.auditedMutation,
}));

import {
  createEmailReminderPreferenceCommands,
  createEmailReminderPreferenceReader,
} from "@/backend/integrations/profile/email-reminder-preferences-adapter";
import { ServiceError } from "@/backend/errors/service-error";

const response = (enabled = false) => ({
  subscription_expiration_email_enabled: enabled,
  email_eligible: true,
  sender_email: "no-reply@example.com",
  days_before: [7, 3, 1],
});

const authorization = {
  accessToken: "provider-access",
  session: { id: "session-1", userId: "user-1" },
};

describe("Remnashop e-mail reminder preference adapter", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.rateLimit.mockResolvedValue(undefined);
    mocks.auditedMutation.mockImplementation(async ({ mutate }) => mutate());
  });

  it("loads and validates the fail-closed preference contract", async () => {
    const api = { load: vi.fn(async () => response()), update: vi.fn() };
    const reader = createEmailReminderPreferenceReader(
      vi.fn(async () => authorization),
      api,
    );

    await expect(reader.load()).resolves.toEqual({
      enabled: false,
      emailEligible: true,
      senderEmail: "no-reply@example.com",
      daysBefore: [7, 3, 1],
    });
    expect(api.load).toHaveBeenCalledWith("provider-access");

    api.load.mockResolvedValueOnce({ ...response(), days_before: [7, 7] });
    await expect(reader.load()).rejects.toMatchObject({ code: "UPSTREAM_UNAVAILABLE" });
  });

  it("rate-limits and audits an exact boolean update", async () => {
    const api = {
      load: vi.fn(),
      update: vi.fn(async (_token: string, enabled: boolean) => response(enabled)),
    };
    const commands = createEmailReminderPreferenceCommands(
      vi.fn(async () => authorization),
      api,
    );
    const actor = await commands.loadActor();

    await commands.assertRateLimit(actor);
    await expect(commands.update(actor, true)).resolves.toMatchObject({ enabled: true });
    expect(mocks.rateLimit).toHaveBeenCalledWith({
      action: "email_reminder_preference",
      sessionId: "session-1",
      limit: 10,
      windowSeconds: 15 * 60,
    });
    expect(mocks.auditedMutation).toHaveBeenCalledWith(expect.objectContaining({
      action: "email_reminder_preference",
      userId: "user-1",
      metadata: { enabled: true },
    }));
    expect(api.update).toHaveBeenCalledWith("provider-access", true);
  });

  it("maps provider eligibility and local rate-limit failures", async () => {
    const providerFailure = new ServiceError(
      "EMAIL_NOT_VERIFIED",
      409,
      "not eligible",
    );
    const commands = createEmailReminderPreferenceCommands(
      vi.fn(async () => authorization),
      { load: vi.fn(), update: vi.fn(async () => { throw providerFailure; }) },
    );
    const actor = await commands.loadActor();
    await expect(commands.update(actor, true)).rejects.toMatchObject({
      code: "EMAIL_NOT_VERIFIED",
    });

    mocks.rateLimit.mockRejectedValueOnce(
      new ServiceError("RATE_LIMITED", 429, "limited"),
    );
    await expect(commands.assertRateLimit(actor)).rejects.toMatchObject({
      code: "RATE_LIMITED",
    });
  });
});
