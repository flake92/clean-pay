import { createHash } from "node:crypto";

const sources = Object.freeze([
  "boundary",
  "browserRequests",
  "browserResponses",
  "diagnostics",
  "history",
  "network",
  "provider",
]);
const sha256Pattern = /^[a-f0-9]{64}$/;

export function createChatwootPhaseEventLedger(maximumEvents = 4_096) {
  if (!Number.isSafeInteger(maximumEvents) || maximumEvents < 64 || maximumEvents > 4_096) {
    fail("Chatwoot event ledger bound is invalid.");
  }
  const counts = Object.fromEntries(sources.map((source) => [source, 0]));
  const observedDigests = Object.fromEntries(sources.map((source) => [source, null]));
  let inFlight = 0;
  let lateEventCount = 0;
  let sealed = false;
  let version = 0;

  const change = (source) => {
    assertSource(source);
    version += 1;
    counts[source] += 1;
    if (sealed) lateEventCount += 1;
    if (Object.values(counts).reduce((sum, count) => sum + count, 0) > maximumEvents) {
      fail("Chatwoot event ledger overflowed.");
    }
  };

  return Object.freeze({
    begin(source) {
      change(source);
      if (sealed) return () => undefined;
      inFlight += 1;
      let completed = false;
      return () => {
        if (completed) fail("Chatwoot event operation completed more than once.");
        completed = true;
        inFlight -= 1;
        version += 1;
      };
    },
    record(source) {
      change(source);
    },
    observe(source, digest) {
      assertSource(source);
      if (!sha256Pattern.test(digest ?? "")) fail("Chatwoot observed source digest is invalid.");
      if (observedDigests[source] !== digest) {
        observedDigests[source] = digest;
        change(source);
      }
    },
    checkpoint(label) {
      if (sealed || inFlight !== 0 || typeof label !== "string" || !/^[a-z][a-z0-9-]{0,63}$/.test(label)) {
        fail("Chatwoot event checkpoint is not at an idle exact boundary.");
      }
      return Object.freeze({
        label,
        version,
        stateSha256: stateSha256(counts, observedDigests, version),
      });
    },
    assertStable(checkpoint) {
      if (!checkpoint || checkpoint.version !== version || inFlight !== 0
        || checkpoint.stateSha256 !== stateSha256(counts, observedDigests, version)) {
        fail("Chatwoot event generation changed during an atomic phase snapshot.");
      }
    },
    async drainAndSeal(isIdle, {
      pollMs = 10,
      quietMs = 200,
      timeoutMs = 5_000,
    } = {}) {
      if (sealed || typeof isIdle !== "function"
        || ![pollMs, quietMs, timeoutMs].every(Number.isSafeInteger)
        || pollMs < 1 || quietMs < pollMs || timeoutMs < quietMs || timeoutMs > 30_000) {
        fail("Chatwoot event drain contract is invalid.");
      }
      const deadline = Date.now() + timeoutMs;
      let observedVersion = version;
      let quietSince = Date.now();
      while (Date.now() <= deadline) {
        if (observedVersion !== version || inFlight !== 0 || !isIdle()) {
          observedVersion = version;
          quietSince = Date.now();
        } else if (Date.now() - quietSince >= quietMs) {
          sealed = true;
          return receipt("drained-and-sealed");
        }
        await new Promise((resolve) => setTimeout(resolve, pollMs));
      }
      fail("Chatwoot event sources did not drain within their bounded lifecycle.");
    },
    assertClean() {
      if (!sealed || inFlight !== 0 || lateEventCount !== 0) {
        fail("Chatwoot event source changed after the final seal.");
      }
      return receipt("sealed-clean");
    },
  });

  function receipt(status) {
    return Object.freeze({
      eventCount: Object.values(counts).reduce((sum, count) => sum + count, 0),
      lateEventCount,
      sourceCounts: Object.freeze({ ...counts }),
      sourceDigestsPresent: Object.freeze(Object.fromEntries(sources.map((source) => [
        source,
        observedDigests[source] !== null,
      ]))),
      stateSha256: stateSha256(counts, observedDigests, version),
      status,
    });
  }
}

function stateSha256(counts, digests, version) {
  return createHash("sha256").update(JSON.stringify({ counts, digests, version })).digest("hex");
}

function assertSource(source) {
  if (!sources.includes(source)) fail("Chatwoot event source is invalid.");
}

function fail(message) {
  throw new Error(message);
}
