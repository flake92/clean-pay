import type { ChatwootSupportContext } from "@/application/models/chatwoot";

const supportContextCacheTtlMs = 60_000;
const supportContextCache = new Map<string, {
  expiresAt: number;
  value: Promise<ChatwootSupportContext | null>;
}>();

export function loadChatwootSupportContextCached(
  identifier: string,
  loader: () => Promise<ChatwootSupportContext | null>,
  now = Date.now(),
) {
  const cached = supportContextCache.get(identifier);

  if (cached && cached.expiresAt > now) {
    return cached.value;
  }

  const value = loader().catch((error) => {
    supportContextCache.delete(identifier);
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
