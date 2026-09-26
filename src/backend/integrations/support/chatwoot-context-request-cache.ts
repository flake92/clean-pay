import type { ChatwootSupportContext } from "@/application/models/chatwoot";

type CacheEntry = {
  expiresAt: number;
  value: Promise<ChatwootSupportContext | null>;
};

type ChatwootSupportContextCacheOptions = {
  maximumConcurrentLoads?: number;
  maximumEntries?: number;
  maximumLoadsPerWindow?: number;
  now?: () => number;
  rateWindowMs?: number;
  ttlMs?: number;
};

const defaultMaximumConcurrentLoads = 8;
const defaultMaximumEntries = 256;
const defaultMaximumLoadsPerWindow = 120;
const defaultRateWindowMs = 60_000;
const defaultTtlMs = 60_000;

export class ChatwootSupportContextCapacityError extends Error {
  constructor(readonly reason: "concurrency_saturated" | "rate_limited") {
    super(`Chatwoot support context ${reason}`);
    this.name = "ChatwootSupportContextCapacityError";
  }
}

export function createChatwootSupportContextRequestCache(
  options: ChatwootSupportContextCacheOptions = {},
) {
  const maximumConcurrentLoads = options.maximumConcurrentLoads
    ?? defaultMaximumConcurrentLoads;
  const maximumEntries = options.maximumEntries ?? defaultMaximumEntries;
  const maximumLoadsPerWindow = options.maximumLoadsPerWindow
    ?? defaultMaximumLoadsPerWindow;
  const rateWindowMs = options.rateWindowMs ?? defaultRateWindowMs;
  const ttlMs = options.ttlMs ?? defaultTtlMs;
  const now = options.now ?? Date.now;
  const entries = new Map<string, CacheEntry>();
  let activeLoads = 0;
  let loadWindow = { count: 0, expiresAt: 0 };

  for (const [name, value] of [
    ["concurrency", maximumConcurrentLoads],
    ["cache size", maximumEntries],
    ["rate limit", maximumLoadsPerWindow],
    ["rate window", rateWindowMs],
    ["cache TTL", ttlMs],
  ] as const) {
    if (!Number.isSafeInteger(value) || value < 1) {
      throw new TypeError(`Chatwoot support context ${name} must be positive`);
    }
  }

  function pruneExpired(currentTime: number) {
    for (const [key, entry] of entries) {
      if (entry.expiresAt <= currentTime) {
        entries.delete(key);
      }
    }
  }

  function makeRoom() {
    while (entries.size >= maximumEntries) {
      const oldestKey = entries.keys().next().value as string | undefined;
      if (oldestKey === undefined) return;
      entries.delete(oldestKey);
    }
  }

  return {
    load(
      userId: string,
      loader: () => Promise<ChatwootSupportContext | null>,
    ) {
      const currentTime = now();
      const cached = entries.get(userId);

      if (cached && cached.expiresAt > currentTime) {
        return cached.value;
      }

      pruneExpired(currentTime);

      if (loadWindow.expiresAt <= currentTime) {
        loadWindow = { count: 0, expiresAt: currentTime + rateWindowMs };
      }
      if (loadWindow.count >= maximumLoadsPerWindow) {
        throw new ChatwootSupportContextCapacityError("rate_limited");
      }
      if (activeLoads >= maximumConcurrentLoads) {
        throw new ChatwootSupportContextCapacityError("concurrency_saturated");
      }
      loadWindow.count += 1;
      activeLoads += 1;
      makeRoom();

      const value = Promise.resolve()
        .then(loader)
        .finally(() => {
          activeLoads -= 1;
        })
        .catch((error) => {
          if (entries.get(userId)?.value === value) {
            entries.delete(userId);
          }
          throw error;
        });
      entries.set(userId, {
        expiresAt: currentTime + ttlMs,
        value,
      });
      return value;
    },
    clear() {
      entries.clear();
    },
  };
}
