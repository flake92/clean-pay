import type { ChatwootSupportContext } from "@/application/models/chatwoot";

const supportContextCacheTtlMs = 60_000;
const supportContextCacheMaximumEntries = 16;
type SupportContextCacheEntry = {
  expiresAt: number;
  value: Promise<ChatwootSupportContext | null>;
};
const supportContextCache = new Map<string, SupportContextCacheEntry>();

function pruneExpiredSupportContextEntries(now: number) {
  for (const [identifier, entry] of supportContextCache) {
    if (entry.expiresAt <= now) {
      supportContextCache.delete(identifier);
    }
  }
}

function makeSupportContextCacheRoom() {
  while (supportContextCache.size >= supportContextCacheMaximumEntries) {
    const oldestIdentifier = supportContextCache.keys().next().value as
      | string
      | undefined;
    if (oldestIdentifier === undefined) return;
    supportContextCache.delete(oldestIdentifier);
  }
}

export function loadChatwootSupportContextCached(
  identifier: string,
  loader: () => Promise<ChatwootSupportContext | null>,
  now = Date.now(),
) {
  const cached = supportContextCache.get(identifier);

  if (cached && cached.expiresAt > now) {
    return cached.value;
  }

  pruneExpiredSupportContextEntries(now);
  makeSupportContextCacheRoom();
  const value = loader().catch((error) => {
    if (supportContextCache.get(identifier)?.value === value) {
      supportContextCache.delete(identifier);
    }
    throw error;
  });
  supportContextCache.set(identifier, {
    expiresAt: now + supportContextCacheTtlMs,
    value,
  });

  return value;
}

export function clearChatwootSupportContextCache() {
  supportContextCache.clear();
}
