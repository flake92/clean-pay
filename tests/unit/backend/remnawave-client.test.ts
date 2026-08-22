import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

vi.mock("@/backend/observability/logger", () => ({
  logger: mocks.logger,
}));

import {
  assertRemnawaveIdentitySynchronizationConfigured,
  getLiveRemnawaveSubscriptionUrl,
  synchronizeRemnawaveUserIdentity,
} from "@/backend/integrations/remnawave/client";

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
        status: "ACTIVE",
        subscriptionUrl: "https://sub3.example.com/token",
      },
    }));
    global.fetch = fetchMock;

    await expect(getLiveRemnawaveSubscriptionUrl({ userRemnaId: "rw-1" }))
      .resolves.toBe("https://sub3.example.com/token");

    expect(fetchMock).toHaveBeenCalledWith("https://panel.example.com/api/users/rw-1", expect.objectContaining({
      headers: expect.objectContaining({ authorization: "Bearer test-token" }),
      cache: "no-store",
    }));
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
          status: "ACTIVE",
          subscriptionUrl: "https://sub3.example.com.evil.invalid/token",
        },
      }))
      .mockResolvedValueOnce(jsonResponse({
        response: {
          uuid: "rw-1",
          status: "ACTIVE",
          subscriptionUrl: "https://user:password@sub3.example.com/token",
        },
      }));
    global.fetch = fetchMock;

    await expect(getLiveRemnawaveSubscriptionUrl({ userRemnaId: "rw-1" })).resolves.toBeNull();
    await expect(getLiveRemnawaveSubscriptionUrl({ userRemnaId: "rw-1" })).resolves.toBeNull();
  });

  it("permits explicitly allowlisted loopback HTTP only outside production", async () => {
    process.env.REMNAWAVE_SUBSCRIPTION_ORIGINS = "http://127.0.0.1:8081";
    global.fetch = vi.fn().mockResolvedValue(jsonResponse({
      response: {
        uuid: "rw-1",
        status: "ACTIVE",
        subscriptionUrl: "http://127.0.0.1:8081/subscription/token",
      },
    }));

    await expect(getLiveRemnawaveSubscriptionUrl({ userRemnaId: "rw-1" }))
      .resolves.toBe("http://127.0.0.1:8081/subscription/token");
  });

  it("rejects a UUID response that belongs to a different or expired user", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse({
        response: {
          uuid: "another-user",
          status: "ACTIVE",
          subscriptionUrl: "https://sub3.example.com/other-user",
        },
      }))
      .mockResolvedValueOnce(jsonResponse({
        response: {
          uuid: "rw-1",
          status: "ACTIVE",
          expireAt: "2020-01-01T00:00:00.000Z",
          subscriptionUrl: "https://sub3.example.com/expired",
        },
      }));
    global.fetch = fetchMock;

    await expect(getLiveRemnawaveSubscriptionUrl({ userRemnaId: "rw-1" })).resolves.toBeNull();
    await expect(getLiveRemnawaveSubscriptionUrl({ userRemnaId: "rw-1" })).resolves.toBeNull();
  });

  it("requires every supplied fallback identity and the stored UUID to match", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse({ message: "not found" }, { status: 404 }))
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
      userRemnaId: "rw-1",
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
      expect.objectContaining({ path: "/users/rw-1", errorName: "Error" }),
      expect.objectContaining({ category: "upstream" }),
    );
    expect(JSON.stringify(mocks.logger.warn.mock.calls)).not.toContain("network token secret");
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
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse({ response: { uuid: "rw-1" } }))
      .mockResolvedValueOnce(jsonResponse({
        response: { uuid: "rw-1", email: "owner@example.com", telegramId: 777 },
      }));
    global.fetch = fetchMock;

    await expect(synchronizeRemnawaveUserIdentity({
      uuid: "rw-1", email: "owner@example.com", telegramId: "777",
    })).resolves.toBeUndefined();
    expect(fetchMock).toHaveBeenNthCalledWith(1, "https://panel.example.com/api/users", expect.objectContaining({
      method: "PATCH",
      body: JSON.stringify({ uuid: "rw-1", email: "owner@example.com", telegramId: 777 }),
    }));
    expect(fetchMock).toHaveBeenNthCalledWith(2, "https://panel.example.com/api/users/rw-1", expect.objectContaining({
      cache: "no-store",
    }));
  });

  it("keeps merge retryable when Remnawave does not confirm the new owner", async () => {
    global.fetch = vi.fn()
      .mockResolvedValueOnce(jsonResponse({ response: { uuid: "rw-1" } }))
      .mockResolvedValueOnce(jsonResponse({
        response: { uuid: "rw-1", email: "owner@example.com", telegramId: 888 },
      }));

    await expect(synchronizeRemnawaveUserIdentity({
      uuid: "rw-1", email: "owner@example.com", telegramId: "777",
    })).rejects.toMatchObject({ code: "UPSTREAM_UNAVAILABLE" });
  });
});
