export type PaymentOperation = "purchase" | "extend";

export type PaymentOperationPayload = Readonly<
  Record<string, boolean | number | string | null>
>;

type StorageLike = Pick<Storage, "getItem" | "removeItem" | "setItem">;

type PaymentIdempotencyDependencies = {
  randomUUID?: () => string;
  storage?: StorageLike;
};

const storagePrefix = "cleanPayPaymentIdempotency:v1";
const fallbackKeys = new Map<string, string>();
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function canonicalPaymentPayload(payload: PaymentOperationPayload) {
  return JSON.stringify(
    Object.fromEntries(
      Object.entries(payload).sort(([left], [right]) =>
        left < right ? -1 : left > right ? 1 : 0,
      ),
    ),
  );
}

export function paymentIdempotencyStorageKey(
  operation: PaymentOperation,
  payload: PaymentOperationPayload,
) {
  return `${storagePrefix}:${operation}:${canonicalPaymentPayload(payload)}`;
}

export function shouldRetainPaymentIdempotencyKey(responseStatus: number) {
  return (
    responseStatus === 202 ||
    responseStatus === 408 ||
    responseStatus === 429 ||
    responseStatus >= 500
  );
}

function browserStorage() {
  if (typeof window === "undefined") {
    return undefined;
  }

  try {
    return window.sessionStorage;
  } catch {
    return undefined;
  }
}

function createUUID() {
  if (typeof globalThis.crypto?.randomUUID === "function") {
    return globalThis.crypto.randomUUID();
  }

  if (typeof globalThis.crypto?.getRandomValues !== "function") {
    throw new Error("Secure random generator is unavailable");
  }

  const bytes = globalThis.crypto.getRandomValues(new Uint8Array(16));

  bytes[6] = ((bytes[6] ?? 0) & 0x0f) | 0x40;
  bytes[8] = ((bytes[8] ?? 0) & 0x3f) | 0x80;
  const hex = Array.from(bytes, (value) => value.toString(16).padStart(2, "0"));

  return [
    hex.slice(0, 4).join(""),
    hex.slice(4, 6).join(""),
    hex.slice(6, 8).join(""),
    hex.slice(8, 10).join(""),
    hex.slice(10, 16).join(""),
  ].join("-");
}

export function getOrCreatePaymentIdempotencyKey(
  operation: PaymentOperation,
  payload: PaymentOperationPayload,
  dependencies: PaymentIdempotencyDependencies = {},
) {
  const storage = dependencies.storage ?? browserStorage();
  const storageKey = paymentIdempotencyStorageKey(operation, payload);

  try {
    const existing = storage?.getItem(storageKey);

    if (existing && uuidPattern.test(existing)) {
      fallbackKeys.set(storageKey, existing);
      return existing;
    }

    if (existing) {
      storage?.removeItem(storageKey);
    }

    if (storage) {
      // A successful empty read is authoritative (for example after the user
      // cleared site data) and must not resurrect an old in-memory key.
      fallbackKeys.delete(storageKey);
    }
  } catch {
    // Storage can be unavailable in privacy-restricted browser contexts.
  }

  const fallbackKey = fallbackKeys.get(storageKey);

  if (fallbackKey) {
    return fallbackKey;
  }

  const idempotencyKey = (dependencies.randomUUID ?? createUUID)();
  fallbackKeys.set(storageKey, idempotencyKey);

  try {
    if (storage) {
      storage.setItem(storageKey, idempotencyKey);
      return idempotencyKey;
    }
  } catch {
    // The request can still be protected for the lifetime of this attempt.
  }

  return idempotencyKey;
}

export function clearPaymentIdempotencyKey(
  operation: PaymentOperation,
  payload: PaymentOperationPayload,
  expectedIdempotencyKey: string,
  dependencies: Pick<PaymentIdempotencyDependencies, "storage"> = {},
) {
  const storage = dependencies.storage ?? browserStorage();
  const storageKey = paymentIdempotencyStorageKey(operation, payload);

  try {
    if (storage?.getItem(storageKey) === expectedIdempotencyKey) {
      storage.removeItem(storageKey);
    }
  } catch {
    // Cleanup is best-effort when storage access is restricted.
  }

  if (fallbackKeys.get(storageKey) === expectedIdempotencyKey) {
    fallbackKeys.delete(storageKey);
  }
}
