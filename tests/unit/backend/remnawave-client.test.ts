import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
  recordUpstreamRequest: vi.fn(),
}));

vi.mock("@/backend/observability/logger", () => ({
  logger: mocks.logger,
}));

vi.mock("@/backend/observability/metrics", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/backend/observability/metrics")>(),
  recordUpstreamRequest: mocks.recordUpstreamRequest,
}));

import {
  assertRemnawaveIdentitySynchronizationConfigured,
  getLiveRemnawaveSubscriptionUrl,
  synchronizeRemnawaveUserIdentity,
} from "@/backend/integrations/remnawave/client";
import {
  patchRemnawaveUserIdentity,
  requestRemnawave,
} from "@/backend/integrations/remnawave/transport";

const originalFetch = global.fetch;

function jsonResponse(body: unknown, init: ResponseInit = {}) {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
    ...init,
  });
}

describe("Remnawave live subscription client", () => {
  beforeEach(() => {
    process.env.REMNAWAVE_API_BASE_URL = "https://panel.example.com";
    process.env.REMNAWAVE_TOKEN = "test-token";
    process.env.REMNAWAVE_SUBSCRIPTION_ORIGINS = "https://sub3.example.com";
    vi.clearAllMocks();
  });

  afterEach(() => {
    global.fetch = originalFetch;
    delete process.env.REMNAWAVE_API_BASE_URL;
    delete process.env.REMNAWAVE_TOKEN;
    delete process.env.REMNAWAVE_SUBSCRIPTION_ORIGINS;
  });

  it("returns subscriptionUrl from the Remnawave user UUID endpoint", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({
      response: {
        uuid: "rw-1",
        email: "owner@example.com",
        status: "ACTIVE",
        subscriptionUrl: "https://sub3.example.com/token",
      },
    }));
    global.fetch = fetchMock;

    await expect(getLiveRemnawaveSubscriptionUrl({
      userRemnaId: "rw-1",
      email: "owner@example.com",
    }))
      .resolves.toBe("https://sub3.example.com/token");

    expect(fetchMock).toHaveBeenCalledWith("https://panel.example.com/api/users/rw-1", expect.objectContaining({
      headers: expect.objectContaining({ authorization: "Bearer test-token" }),
      cache: "no-store",
    }));
    expect(fetchMock).toHaveBeenCalledWith(
      "https://panel.example.com/api/users/rw-1",
      expect.objectContaining({ redirect: "error" }),
    );
    expect(mocks.recordUpstreamRequest).toHaveBeenCalledOnce();
    expect(mocks.recordUpstreamRequest).toHaveBeenCalledWith({
      service: "remnawave",
      operation: "/users/:id",
      outcome: "success",
      durationMs: expect.any(Number),
    });
  });

  it("records one success metric only after endpoint decoding", async () => {
    global.fetch = vi.fn().mockResolvedValue(jsonResponse({
      response: { uuid: "rw-1" },
    }));
    const decode = vi.fn((value: unknown) => value);

    await expect(requestRemnawave("/users/rw-1", decode)).resolves.toEqual({
      response: { uuid: "rw-1" },
    });

    expect(decode).toHaveBeenCalledOnce();
    expect(mocks.recordUpstreamRequest).toHaveBeenCalledOnce();
    expect(decode.mock.invocationCallOrder[0])
      .toBeLessThan(mocks.recordUpstreamRequest.mock.invocationCallOrder[0]!);
  });

  it.each([301, 302, 307, 308])(
    "does not replay credentials for redirect status %s and measures after cancellation",
    async (status) => {
      const cancel = vi.fn();
      const response = new Response(new ReadableStream({ cancel }), {
        status,
        headers: { location: "https://redirect.example/credential-target" },
      });
      const fetchMock = vi.fn().mockResolvedValue(response);
      global.fetch = fetchMock;

      await expect(getLiveRemnawaveSubscriptionUrl({ userRemnaId: "rw-1" }))
        .resolves.toBeNull();

      expect(fetchMock).toHaveBeenCalledOnce();
      expect(fetchMock).toHaveBeenCalledWith(
        "https://panel.example.com/api/users/rw-1",
        expect.objectContaining({ redirect: "error" }),
      );
      expect(cancel).toHaveBeenCalledOnce();
      expect(mocks.recordUpstreamRequest).toHaveBeenCalledOnce();
      expect(mocks.recordUpstreamRequest).toHaveBeenCalledWith(
        expect.objectContaining({ outcome: "rejected" }),
      );
      expect(cancel.mock.invocationCallOrder[0])
        .toBeLessThan(mocks.recordUpstreamRequest.mock.invocationCallOrder[0]!);
    },
  );

  it("measures the credentialed identity PATCH once after body cancellation", async () => {
    const cancel = vi.fn();
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(new ReadableStream({ cancel }), { status: 200 }),
    );
    global.fetch = fetchMock;

    await expect(patchRemnawaveUserIdentity(
      { endpoint: "https://panel.example.com/api/users", token: "test-token" },
      { uuid: "rw-1", email: "owner@example.com", telegramId: "777" },
    )).resolves.toEqual({ kind: "success" });

    expect(fetchMock).toHaveBeenCalledOnce();
    expect(fetchMock).toHaveBeenCalledWith(
      "https://panel.example.com/api/users",
      expect.objectContaining({
        method: "PATCH",
        redirect: "error",
        body: JSON.stringify({
          uuid: "rw-1",
          email: "owner@example.com",
          telegramId: 777,
        }),
      }),
    );
    expect(cancel).toHaveBeenCalledOnce();
    expect(mocks.recordUpstreamRequest).toHaveBeenCalledOnce();
    expect(mocks.recordUpstreamRequest).toHaveBeenCalledWith({
      service: "remnawave",
      operation: "/users",
      outcome: "success",
      durationMs: expect.any(Number),
    });
    expect(cancel.mock.invocationCallOrder[0])
      .toBeLessThan(mocks.recordUpstreamRequest.mock.invocationCallOrder[0]!);
  });

  it("fails closed once for malformed and oversized user payloads", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse({
        response: {
          uuid: ["rw-1"],
          status: "ACTIVE",
          subscriptionUrl: "https://sub3.example.com/leak",
          provider_secret: "must-not-project",
        },
      }))
      .mockResolvedValueOnce(new Response("{}", {
        status: 200,
        headers: { "content-length": String(2 * 1024 * 1024) },
      }));
    global.fetch = fetchMock;

    await expect(getLiveRemnawaveSubscriptionUrl({ userRemnaId: "rw-1" }))
      .resolves.toBeNull();
    expect(mocks.recordUpstreamRequest).toHaveBeenCalledTimes(1);
    expect(mocks.recordUpstreamRequest).toHaveBeenLastCalledWith(
      expect.objectContaining({ outcome: "unavailable" }),
    );
    expect(JSON.stringify(mocks.logger.warn.mock.calls))
      .not.toContain("must-not-project");

    vi.clearAllMocks();
    await expect(getLiveRemnawaveSubscriptionUrl({ userRemnaId: "rw-1" }))
      .resolves.toBeNull();
    expect(mocks.recordUpstreamRequest).toHaveBeenCalledTimes(1);
    expect(mocks.recordUpstreamRequest).toHaveBeenLastCalledWith(
      expect.objectContaining({ outcome: "unavailable" }),
    );
  });

  it("falls back to Telegram and e-mail lookup when the stored UUID is not live", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse({ message: "not found" }, { status: 404 }))
      .mockResolvedValueOnce(jsonResponse({
        response: [{
          uuid: "rw-2",
          status: "ACTIVE",
          email: "user@example.com",
          telegramId: 123,
          expireAt: "2099-08-01T00:00:00.000Z",
          subscriptionUrl: "https://sub3.example.com/from-telegram",
        }],
      }))
      .mockResolvedValueOnce(jsonResponse({ response: [] }));
    global.fetch = fetchMock;

    await expect(getLiveRemnawaveSubscriptionUrl({
      userRemnaId: "rw-2",
      email: "user@example.com",
      telegramId: "123",
    })).resolves.toBe("https://sub3.example.com/from-telegram");

    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      "https://panel.example.com/api/users/by-telegram-id/123",
      expect.any(Object),
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      3,
      "https://panel.example.com/api/users/by-email/user%40example.com",
      expect.any(Object),
    );
  });

  it("prefers active live users over inactive users from identity lookup", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse({
        response: [
          {
            uuid: "rw-disabled",
            status: "DISABLED",
            email: "user@example.com",
            expireAt: "2027-01-01T00:00:00.000Z",
            subscriptionUrl: "https://sub3.example.com/disabled",
          },
          {
            uuid: "rw-active",
            status: "ACTIVE",
            email: "user@example.com",
            expireAt: "2099-08-01T00:00:00.000Z",
            subscriptionUrl: "https://sub3.example.com/active",
          },
        ],
      }));
    global.fetch = fetchMock;

    await expect(getLiveRemnawaveSubscriptionUrl({ email: "user@example.com" }))
      .resolves.toBe("https://sub3.example.com/active");
  });

  it("returns null when Remnawave does not provide a valid subscription URL", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse({
        response: {
          uuid: "rw-1",
          status: "ACTIVE",
          subscriptionUrl: "",
        },
      }))
      .mockResolvedValueOnce(jsonResponse({
        response: [{
          uuid: "rw-2",
          status: "ACTIVE",
          subscriptionUrl: "not-a-url",
        }],
      }));
    global.fetch = fetchMock;

    await expect(getLiveRemnawaveSubscriptionUrl({
      userRemnaId: "rw-1",
      email: "user@example.com",
    })).resolves.toBeNull();
  });

  it("accepts only an exact allowlisted origin and rejects URL credentials", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse({
        response: {
          uuid: "rw-1",
          email: "owner@example.com",
          status: "ACTIVE",
          subscriptionUrl: "https://sub3.example.com.evil.invalid/token",
        },
      }))
      .mockResolvedValueOnce(jsonResponse({ response: [] }))
      .mockResolvedValueOnce(jsonResponse({
        response: {
          uuid: "rw-1",
          email: "owner@example.com",
          status: "ACTIVE",
          subscriptionUrl: "https://user:password@sub3.example.com/token",
        },
      }))
      .mockResolvedValueOnce(jsonResponse({ response: [] }));
    global.fetch = fetchMock;

    await expect(getLiveRemnawaveSubscriptionUrl({
      userRemnaId: "rw-1", email: "owner@example.com",
    })).resolves.toBeNull();
    await expect(getLiveRemnawaveSubscriptionUrl({
      userRemnaId: "rw-1", email: "owner@example.com",
    })).resolves.toBeNull();
  });

  it("permits explicitly allowlisted loopback HTTP only outside production", async () => {
    process.env.REMNAWAVE_SUBSCRIPTION_ORIGINS = "http://127.0.0.1:8081";
    global.fetch = vi.fn().mockResolvedValue(jsonResponse({
      response: {
        uuid: "rw-1",
        email: "owner@example.com",
        status: "ACTIVE",
        subscriptionUrl: "http://127.0.0.1:8081/subscription/token",
      },
    }));

    await expect(getLiveRemnawaveSubscriptionUrl({
      userRemnaId: "rw-1",
      email: "owner@example.com",
    }))
      .resolves.toBe("http://127.0.0.1:8081/subscription/token");
  });

  it("rejects a UUID response that belongs to a different or expired user", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse({
        response: {
          uuid: "another-user",
          email: "owner@example.com",
          status: "ACTIVE",
          subscriptionUrl: "https://sub3.example.com/other-user",
        },
      }))
      .mockResolvedValueOnce(jsonResponse({ response: [] }))
      .mockResolvedValueOnce(jsonResponse({
        response: {
          uuid: "rw-1",
          email: "owner@example.com",
          status: "ACTIVE",
          expireAt: "2020-01-01T00:00:00.000Z",
          subscriptionUrl: "https://sub3.example.com/expired",
        },
      }))
      .mockResolvedValueOnce(jsonResponse({ response: [] }));
    global.fetch = fetchMock;

    await expect(getLiveRemnawaveSubscriptionUrl({
      userRemnaId: "rw-1", email: "owner@example.com",
    })).resolves.toBeNull();
    await expect(getLiveRemnawaveSubscriptionUrl({
      userRemnaId: "rw-1", email: "owner@example.com",
    })).resolves.toBeNull();
  });

  it("accepts an exact stored UUID when Telegram still matches after an e-mail change", async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(jsonResponse({
      response: {
        uuid: "rw-1",
        status: "ACTIVE",
        email: "legacy@example.com",
        telegramId: "123",
        subscriptionUrl: "https://sub3.example.com/current",
      },
    }));
    global.fetch = fetchMock;

    await expect(getLiveRemnawaveSubscriptionUrl({
      userRemnaId: "rw-1",
      email: "owner@example.com",
      telegramId: "123",
    })).resolves.toBe("https://sub3.example.com/current");
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it("rejects an exact stored UUID when neither supplied identity matches", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse({
        response: {
          uuid: "rw-1",
          status: "ACTIVE",
          email: "victim@example.com",
          telegramId: "456",
          subscriptionUrl: "https://sub3.example.com/victim-direct",
        },
      }))
      .mockResolvedValueOnce(jsonResponse({ response: [] }))
      .mockResolvedValueOnce(jsonResponse({ response: [] }));
    global.fetch = fetchMock;

    await expect(getLiveRemnawaveSubscriptionUrl({
      userRemnaId: "rw-1",
      email: "owner@example.com",
      telegramId: "123",
    })).resolves.toBeNull();
  });

  it("requires every supplied identity to match during fallback lookup", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse({
        response: [{
          uuid: "rw-1",
          status: "ACTIVE",
          email: "victim@example.com",
          telegramId: "123",
          subscriptionUrl: "https://sub3.example.com/victim",
        }],
      }))
      .mockResolvedValueOnce(jsonResponse({ response: [] }));
    global.fetch = fetchMock;

    await expect(getLiveRemnawaveSubscriptionUrl({
      email: "owner@example.com",
      telegramId: "123",
    })).resolves.toBeNull();
  });

  it("accepts only one URL for duplicate identity records and never chooses among conflicts", async () => {
    const duplicate = {
      uuid: "rw-1",
      status: "ACTIVE",
      email: "user@example.com",
      subscriptionUrl: "https://sub3.example.com/same",
    };
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse({ response: [duplicate, duplicate] }))
      .mockResolvedValueOnce(jsonResponse({
        response: [duplicate, { ...duplicate, subscriptionUrl: "https://sub3.example.com/conflict" }],
      }));
    global.fetch = fetchMock;

    await expect(getLiveRemnawaveSubscriptionUrl({ email: "user@example.com" }))
      .resolves.toBe("https://sub3.example.com/same");
    await expect(getLiveRemnawaveSubscriptionUrl({ email: "user@example.com" })).resolves.toBeNull();
  });

  it("returns null when Remnawave is unavailable", async () => {
    const fetchMock = vi.fn().mockRejectedValue(new Error("network token secret"));
    global.fetch = fetchMock;

    await expect(getLiveRemnawaveSubscriptionUrl({ userRemnaId: "rw-1" })).resolves.toBeNull();

    expect(mocks.logger.warn).toHaveBeenCalledWith(
      "remnawave_live_subscription_unavailable",
      expect.objectContaining({ path: "/users/:id", errorName: "Error" }),
      expect.objectContaining({ category: "upstream" }),
    );
    expect(JSON.stringify(mocks.logger.warn.mock.calls)).not.toContain("network token secret");
    expect(JSON.stringify(mocks.logger.warn.mock.calls)).not.toContain("rw-1");
  });

  it("validates identity synchronization configuration without a network request", () => {
    global.fetch = vi.fn();

    expect(() => assertRemnawaveIdentitySynchronizationConfigured()).not.toThrow();
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it("rejects identity synchronization before mutation when it is not configured", () => {
    delete process.env.REMNAWAVE_API_BASE_URL;
    delete process.env.REMNAWAVE_TOKEN;

    expect(() => assertRemnawaveIdentitySynchronizationConfigured())
      .toThrow(expect.objectContaining({ code: "UPSTREAM_UNAVAILABLE", status: 503 }));
  });

  it("updates and verifies the subscription owner identity with the Remnawave 2.7 API", async () => {
    const beforeMutation = vi.fn(async () => undefined);
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse({
        response: { uuid: "rw-1", email: "owner@example.com", telegramId: 888 },
      }))
      .mockResolvedValueOnce(jsonResponse({ response: { uuid: "rw-1" } }))
      .mockResolvedValueOnce(jsonResponse({
        response: { uuid: "rw-1", email: "owner@example.com", telegramId: 777 },
      }));
    global.fetch = fetchMock;

    await expect(synchronizeRemnawaveUserIdentity({
      uuid: "rw-1", email: "owner@example.com", telegramId: "777",
    }, beforeMutation)).resolves.toBeUndefined();
    expect(fetchMock).toHaveBeenNthCalledWith(1, "https://panel.example.com/api/users/rw-1", expect.objectContaining({
      cache: "no-store",
    }));
    expect(fetchMock).toHaveBeenNthCalledWith(2, "https://panel.example.com/api/users", expect.objectContaining({
      method: "PATCH",
      body: JSON.stringify({ uuid: "rw-1", email: "owner@example.com", telegramId: 777 }),
    }));
    expect(fetchMock).toHaveBeenNthCalledWith(3, "https://panel.example.com/api/users/rw-1", expect.objectContaining({
      cache: "no-store",
    }));
    expect(beforeMutation).toHaveBeenCalledOnce();
    expect(fetchMock.mock.invocationCallOrder[0]).toBeLessThan(beforeMutation.mock.invocationCallOrder[0]!);
    expect(beforeMutation.mock.invocationCallOrder[0]).toBeLessThan(fetchMock.mock.invocationCallOrder[1]!);
  });

  it("keeps merge retryable when Remnawave does not confirm the new owner", async () => {
    global.fetch = vi.fn()
      .mockResolvedValueOnce(jsonResponse({
        response: { uuid: "rw-1", email: "owner@example.com", telegramId: 888 },
      }))
      .mockResolvedValueOnce(jsonResponse({ response: { uuid: "rw-1" } }))
      .mockResolvedValueOnce(jsonResponse({
        response: { uuid: "rw-1", email: "owner@example.com", telegramId: 888 },
      }));

    await expect(synchronizeRemnawaveUserIdentity({
      uuid: "rw-1", email: "owner@example.com", telegramId: "777",
    }, vi.fn(async () => undefined))).rejects.toMatchObject({ code: "UPSTREAM_UNAVAILABLE" });
  });

  it("rejects an unrelated UUID owner before issuing PATCH", async () => {
    const beforeMutation = vi.fn(async () => undefined);
    const fetchMock = vi.fn().mockResolvedValueOnce(jsonResponse({
      response: { uuid: "rw-1", email: "victim@example.com", telegramId: 999 },
    }));
    global.fetch = fetchMock;

    await expect(synchronizeRemnawaveUserIdentity({
      uuid: "rw-1", email: "owner@example.com", telegramId: "777",
    }, beforeMutation)).rejects.toMatchObject({ code: "UPSTREAM_UNAVAILABLE" });
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(beforeMutation).not.toHaveBeenCalled();
  });

  it("skips PATCH when both stable owner identities already match", async () => {
    const beforeMutation = vi.fn(async () => undefined);
    const fetchMock = vi.fn().mockResolvedValueOnce(jsonResponse({
      response: { uuid: "rw-1", email: "owner@example.com", telegramId: 777 },
    }));
    global.fetch = fetchMock;

    await expect(synchronizeRemnawaveUserIdentity({
      uuid: "rw-1", email: "owner@example.com", telegramId: "777",
    }, beforeMutation)).resolves.toBeUndefined();
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(beforeMutation).not.toHaveBeenCalled();
  });
});
