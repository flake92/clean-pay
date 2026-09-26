export const CHATWOOT_IDENTITY_PROBE_LIMIT = 6;
export const CHATWOOT_INITIAL_IDENTITY_PROBE_DELAY_MS = 750;

export function chatwootIdentityAttemptRemainingMs(
  startedAt: number,
  timeoutMs: number,
  now: number,
) {
  return Math.max(0, startedAt + timeoutMs - now);
}

export function chatwootIdentityProbeRemainingMs(
  startedAt: number,
  timeoutMs: number,
  now: number,
) {
  return startedAt + timeoutMs - now;
}

export function chatwootIdentityProbeRetryDelayMs(
  startedAt: number,
  now: number,
) {
  const elapsedMs = Math.max(0, now - startedAt);
  return Math.min(2_000, Math.max(400, elapsedMs));
}

export function boundedChatwootIdentityProbeDelayMs(
  delayMs: number,
  remainingMs: number,
) {
  return Math.min(Math.max(0, delayMs), remainingMs);
}

export function chatwootSessionRefreshTarget(
  pathname: string,
  locationSearch: string,
) {
  const returnTo = `${pathname}${locationSearch}`;
  const search = new URLSearchParams({ return_to: returnTo });
  return `/auth/session/refresh?${search.toString()}`;
}
