import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  auditedMutation: vi.fn(),
  deletePush: vi.fn(),
  pushKey: vi.fn(),
  pushStatus: vi.fn(),
  rateLimit: vi.fn(),
  savePush: vi.fn(),
  unsubscribe: vi.fn(),
}));

vi.mock("@/backend/integrations/remnashop/api-client", () => ({
  deleteRemnashopPushSubscription: mocks.deletePush,
  getRemnashopPushKey: mocks.pushKey,
  getRemnashopPushStatus: mocks.pushStatus,
  remnashopUnsubscribeEmail: mocks.unsubscribe,
  saveRemnashopPushSubscription: mocks.savePush,
}));
vi.mock("@/backend/limits/rate-limit", () => ({ assertTargetRateLimit: mocks.rateLimit }));
vi.mock("@/backend/observability/mutation-audit", () => ({
  auditedMutation: mocks.auditedMutation,
}));

import {
  loadPushSetup,
  parsePushSubscriptionInput,
  removePushSubscription,
  savePushSubscription,
} from "@/application/notifications/push-subscription";
import { unsubscribeEmail } from "@/application/notifications/unsubscribe-email";
import { ServiceError } from "@/backend/errors/service-error";
import {
  createEmailUnsubscribeGateway,
  createPushSubscriptionCommands,
} from "@/backend/integrations/notifications/notification-channels-adapter";

const authorization = {
  accessToken: "provider-access",
  session: { id: "session-1", userId: "user-1" },
};
const subscription = {
  endpoint: "https://fcm.googleapis.com/fcm/send/abc",
  p256dh: "B".repeat(87),
  auth: "a".repeat(22),
  userAgent: "Mozilla/5.0",
};
const token = `42.N.${"0".repeat(32)}`;

describe("push subscription commands", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.auditedMutation.mockImplementation(async ({ mutate }) => mutate());
    mocks.rateLimit.mockResolvedValue(undefined);
    mocks.pushKey.mockResolvedValue({ enabled: true, public_key: "BKey" });
    mocks.pushStatus.mockResolvedValue({ devices: 1 });
    mocks.savePush.mockResolvedValue({ devices: 2 });
    mocks.deletePush.mockResolvedValue({ devices: 0 });
  });

  it("loads the VAPID key and the device count for the session", async () => {
    const commands = createPushSubscriptionCommands(async () => authorization);

    await expect(loadPushSetup(commands)).resolves.toEqual({
      status: "ready",
      publicKey: "BKey",
      devices: 1,
    });
    expect(mocks.pushStatus).toHaveBeenCalledWith("provider-access");

    mocks.pushKey.mockResolvedValueOnce({ enabled: false, public_key: null });
    await expect(loadPushSetup(commands)).resolves.toEqual({ status: "unavailable" });
  });

  it("saves a validated browser subscription after the rate limit", async () => {
    const commands = createPushSubscriptionCommands(async () => authorization);

    await expect(savePushSubscription(commands, subscription)).resolves.toMatchObject({
      ok: true,
      devices: 2,
    });
    expect(mocks.rateLimit).toHaveBeenCalledWith(expect.objectContaining({
      action: "push_subscription",
      sessionId: "session-1",
    }));
    expect(mocks.savePush).toHaveBeenCalledWith("provider-access", {
      endpoint: subscription.endpoint,
      keys: { p256dh: subscription.p256dh, auth: subscription.auth },
      user_agent: "Mozilla/5.0",
    });

    await expect(removePushSubscription(commands, subscription.endpoint)).resolves.toMatchObject({
      ok: true,
      devices: 0,
    });
    expect(mocks.deletePush).toHaveBeenCalledWith("provider-access", subscription.endpoint);
  });

  it("rejects malformed subscriptions before any provider call", async () => {
    const commands = createPushSubscriptionCommands(async () => authorization);
    for (const value of [
      null,
      { ...subscription, endpoint: "http://fcm.googleapis.com/x" },
      { ...subscription, p256dh: "short" },
      { ...subscription, auth: "not base64!!" },
    ]) {
      expect(parsePushSubscriptionInput(value)).toBeNull();
      await expect(savePushSubscription(commands, value)).resolves.toMatchObject({
        ok: false,
        code: "VALIDATION_ERROR",
      });
    }
    expect(mocks.savePush).not.toHaveBeenCalled();
  });

  it("turns every provider failure into a gateway error code", async () => {
    const expired = createPushSubscriptionCommands(async () => {
      throw new ServiceError("UNAUTHORIZED", 401, "expired");
    });
    await expect(expired.loadActor()).rejects.toMatchObject({ code: "UNAUTHORIZED" });

    const commands = createPushSubscriptionCommands(async () => authorization);
    const actor = await commands.loadActor();
    const outage = new Error("socket hang up");
    mocks.rateLimit.mockRejectedValueOnce(new ServiceError("RATE_LIMITED", 429, "slow down"));
    await expect(commands.assertRateLimit(actor)).rejects.toMatchObject({ code: "RATE_LIMITED" });
    mocks.pushKey.mockRejectedValueOnce(outage);
    await expect(commands.publicKey()).rejects.toMatchObject({ code: "UPSTREAM_UNAVAILABLE" });
    mocks.pushStatus.mockRejectedValueOnce(outage);
    await expect(commands.devices(actor)).rejects.toMatchObject({ code: "UPSTREAM_UNAVAILABLE" });
    mocks.deletePush.mockRejectedValueOnce(outage);
    await expect(commands.remove(actor, subscription.endpoint))
      .rejects.toMatchObject({ code: "UPSTREAM_UNAVAILABLE" });

    mocks.pushKey.mockResolvedValueOnce({ enabled: false, public_key: null });
    await expect(commands.publicKey()).resolves.toBeNull();
  });

  it("maps provider refusals to user-facing codes", async () => {
    const commands = createPushSubscriptionCommands(async () => authorization);
    mocks.savePush.mockRejectedValueOnce(new ServiceError("VALIDATION_ERROR", 422, "push service"));
    await expect(savePushSubscription(commands, subscription)).resolves.toMatchObject({
      ok: false,
      code: "UNSUPPORTED_PUSH_SERVICE",
    });
    mocks.savePush.mockRejectedValueOnce(new ServiceError("CONFLICT", 409, "disabled"));
    await expect(savePushSubscription(commands, subscription)).resolves.toMatchObject({
      ok: false,
      code: "PUSH_DISABLED",
    });
  });
});

describe("e-mail unsubscribe", () => {
  beforeEach(() => vi.clearAllMocks());

  it("passes only a well-formed token to Remnashop", async () => {
    mocks.unsubscribe.mockResolvedValue({ category: "NEWS" });
    const gateway = createEmailUnsubscribeGateway();

    await expect(unsubscribeEmail(gateway, token)).resolves.toMatchObject({
      ok: true,
      category: "news",
    });
    expect(mocks.unsubscribe).toHaveBeenCalledWith(token);

    await expect(unsubscribeEmail(gateway, "42.N.xyz")).resolves.toMatchObject({
      ok: false,
      code: "INVALID_TOKEN",
    });
    await expect(unsubscribeEmail(gateway, null)).resolves.toMatchObject({ ok: false });
    expect(mocks.unsubscribe).toHaveBeenCalledTimes(1);
  });

  it("reports a forged token and an outage differently", async () => {
    const gateway = createEmailUnsubscribeGateway();
    mocks.unsubscribe.mockRejectedValueOnce(new ServiceError("VALIDATION_ERROR", 400, "bad"));
    await expect(unsubscribeEmail(gateway, token)).resolves.toMatchObject({
      ok: false,
      code: "INVALID_TOKEN",
    });
    mocks.unsubscribe.mockRejectedValueOnce(new ServiceError("UPSTREAM_UNAVAILABLE", 503, "down"));
    await expect(unsubscribeEmail(gateway, token)).resolves.toMatchObject({
      ok: false,
      code: "UPSTREAM_UNAVAILABLE",
    });
  });
});
