export type BffJsonResult<T> = {
  ok: boolean;
  status: number;
  data: T | null;
};

// Only coalesce requests that overlap. Keeping successful responses here would
// make auth/profile data survive logout and a later login in the same tab.
const inFlightRequests = new Map<string, Promise<BffJsonResult<unknown>>>();

async function requestBffJson<T>(url: string): Promise<BffJsonResult<T>> {
  const response = await fetch(url, { cache: "no-store" });
  const body = await response.json().catch(() => null);

  return {
    ok: response.ok,
    status: response.status,
    data: (body?.data ?? null) as T | null,
  };
}

export function getCachedBffJson<T>(url: string): Promise<BffJsonResult<T>> {
  const existing = inFlightRequests.get(url);

  if (existing) {
    return existing as Promise<BffJsonResult<T>>;
  }

  const request = requestBffJson<T>(url).finally(() => {
    if (inFlightRequests.get(url) === request) {
      inFlightRequests.delete(url);
    }
  });
  inFlightRequests.set(url, request as Promise<BffJsonResult<unknown>>);

  return request;
}

export function invalidateCachedBffJson(url?: string) {
  if (url) {
    inFlightRequests.delete(url);
  } else {
    inFlightRequests.clear();
  }
}

export async function getAuthenticatedBffJson<T>(url: string) {
  const initial = await getCachedBffJson<T>(url);
  if (initial.status !== 401) {
    return initial;
  }

  // A navigation can start while the login response is still completing.
  // Do not let an overlapping pre-auth request become the cabinet's terminal
  // state. Resolved requests leave the in-flight map, so this performs one
  // fresh non-cacheable identity check that other consumers can share.
  return getCachedBffJson<T>(url);
}
