import { describe, expect, it, vi } from "vitest";

import type { ChatwootSupportContext } from "@/application/models/chatwoot";
import {
  ChatwootSupportContextCapacityError,
  createChatwootSupportContextRequestCache,
} from "@/backend/integrations/support/chatwoot-context-request-cache";

const context: ChatwootSupportContext = {
  customAttributes: { subscription_status: "active" },
  managedLabels: [],
};

describe("Chatwoot support context request cache", () => {
  it("coalesces a user's concurrent work and expires the bounded value", async () => {
    let now = 1_000;
    const cache = createChatwootSupportContextRequestCache({
      maximumEntries: 2,
      now: () => now,
      ttlMs: 100,
    });
    const loader = vi.fn().mockResolvedValue(context);

    const first = cache.load("user-1", loader);
    const concurrent = cache.load("user-1", loader);
    expect(concurrent).toBe(first);
    await expect(first).resolves.toEqual(context);
    expect(loader).toHaveBeenCalledOnce();

    now += 100;
    await expect(cache.load("user-1", loader)).resolves.toEqual(context);
    expect(loader).toHaveBeenCalledTimes(2);
  });

  it("evicts the oldest user instead of growing without a bound", async () => {
    const cache = createChatwootSupportContextRequestCache({
      maximumEntries: 2,
      ttlMs: 1_000,
    });
    const loader = vi.fn().mockResolvedValue(context);

    await cache.load("user-1", loader);
    await cache.load("user-2", loader);
    await cache.load("user-3", loader);
    await cache.load("user-2", loader);
    await cache.load("user-1", loader);

    expect(loader).toHaveBeenCalledTimes(4);
  });

  it("does not cache rejected work", async () => {
    const cache = createChatwootSupportContextRequestCache();
    const loader = vi.fn()
      .mockRejectedValueOnce(new Error("provider unavailable"))
      .mockResolvedValueOnce(context);

    await expect(cache.load("user-1", loader))
      .rejects.toThrow("provider unavailable");
    await expect(cache.load("user-1", loader)).resolves.toEqual(context);
    expect(loader).toHaveBeenCalledTimes(2);
  });

  it("bounds distinct concurrent provider loads without blocking coalesced work", async () => {
    let release!: () => void;
    const pending = new Promise<ChatwootSupportContext>((resolve) => {
      release = () => resolve(context);
    });
    const cache = createChatwootSupportContextRequestCache({
      maximumConcurrentLoads: 1,
    });
    const loader = vi.fn(() => pending);

    const first = cache.load("user-1", loader);
    expect(cache.load("user-1", loader)).toBe(first);
    expect(() => cache.load("user-2", loader)).toThrow(
      new ChatwootSupportContextCapacityError("concurrency_saturated"),
    );

    release();
    await expect(first).resolves.toEqual(context);
    await expect(cache.load("user-2", loader)).resolves.toEqual(context);
  });

  it("rate limits new provider loads while keeping cached reads available", async () => {
    let now = 1_000;
    const cache = createChatwootSupportContextRequestCache({
      maximumLoadsPerWindow: 1,
      now: () => now,
      rateWindowMs: 100,
    });
    const loader = vi.fn().mockResolvedValue(context);

    await cache.load("user-1", loader);
    await expect(cache.load("user-1", loader)).resolves.toEqual(context);
    expect(() => cache.load("user-2", loader)).toThrow(
      new ChatwootSupportContextCapacityError("rate_limited"),
    );

    now += 100;
    await expect(cache.load("user-2", loader)).resolves.toEqual(context);
  });

  it("rejects unsafe cache bounds during composition", () => {
    expect(() => createChatwootSupportContextRequestCache({ maximumEntries: 0 }))
      .toThrow("cache size must be positive");
    expect(() => createChatwootSupportContextRequestCache({ maximumConcurrentLoads: 0 }))
      .toThrow("concurrency must be positive");
    expect(() => createChatwootSupportContextRequestCache({ maximumLoadsPerWindow: 0 }))
      .toThrow("rate limit must be positive");
    expect(() => createChatwootSupportContextRequestCache({ rateWindowMs: 0 }))
      .toThrow("rate window must be positive");
    expect(() => createChatwootSupportContextRequestCache({ ttlMs: 0 }))
      .toThrow("cache TTL must be positive");
  });
});
