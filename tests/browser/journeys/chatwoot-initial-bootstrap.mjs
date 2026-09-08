/** Test transport scheduling only. Never substitutes app responses or storage. */
export function createInitialChatwootBootstrap() {
  let delivered = false;
  let claimed = false;
  let failure;
  let resolve, reject;
  const ready = new Promise((yes, no) => { resolve = yes; reject = no; });
  // Failures may precede the SDK request; retain them without an unhandled rejection.
  void ready.catch(() => {});
  const assertHealthy = () => { if (failure !== undefined) throw failure; };
  return Object.freeze({
    profileContextDelivered() { assertHealthy(); delivered = true; resolve(); },
    profileReady() { assertHealthy(); return ready; },
    assertProfileReady() {
      assertHealthy();
      if (!delivered) throw new Error("Chatwoot profile context was not delivered before its SDK.");
    },
    claimInitialCabinetContext() {
      assertHealthy();
      if (claimed) return false;
      if (!delivered) throw new Error("Chatwoot cabinet bootstrap preceded the profile context.");
      claimed = true; return true;
    },
    assertCabinetContextClaimed() {
      assertHealthy();
      if (!claimed) throw new Error("Chatwoot initial cabinet context action was not scheduled.");
    },
    fail(error) {
      failure ??= error instanceof Error ? error : new Error("Chatwoot bootstrap failed.");
      reject(failure);
    },
  });
}

// RSC action content is inspected only to identify the context response. Its
// raw content is not logged, normalized, replaced, or sent to another endpoint.
export function isInitialChatwootContextResponse(text) {
  return typeof text === "string" && text.length <= 2 * 1024 * 1024
    && /"customAttributes"\s*:\s*\{/.test(text)
    && /"subscription_context_status"\s*:/.test(text)
    && /"payment_context_status"\s*:/.test(text)
    && /"managedLabels"\s*:\s*\[/.test(text);
}
