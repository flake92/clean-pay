import { types } from "node:util";

const maximumOccurrences = 8;
const phases = new Set([
  "reset-provider-fixture", "exercise-browser-cabinet", "read-provider-concurrency-ledger",
  "complete-provider-proof", "launch-browser", "create-browser-context",
  "install-history-binding", "install-history-instrumentation", "create-browser-page",
  "create-cdp-session", "install-websocket-routing", "install-request-routing",
  "navigate-login", "wait-telegram-visible", "wait-turnstile-token", "wait-telegram-enabled",
  "drain-login-requests", "navigate-profile", "wait-profile-heading", "settle-profile-dom",
  "wait-profile-chatwoot-identity", "drain-profile-history-before-idle",
  "wait-profile-network-idle", "drain-profile-history-after-idle", "drain-profile-requests",
  "inspect-profile-frame", "arm-provider-overlap", "navigate-cabinet",
  "wait-cabinet-navigation", "wait-cabinet-heading", "drain-cabinet-history",
  "drain-cabinet-requests", "drain-pending-requests", "verify-final-response-captures",
  "finalize-event-lifecycle", "finalize-event-seal", "finalize-event-drain",
  "finalize-source-revalidation", "finalize-browser-close", "finalize-listener-detach",
  "finalize-response-capture", "finalize-browser-projection", "finalize-browser-snapshot",
  "validate-sealed-ledger", "complete-browser-cabinet",
]);
const checkpoints = new Set(["profile-quiet-completed", "cabinet-goto-called"]);

// The caller selects only identity-owned app-profile-action requests. This is a
// synchronous observation: it neither awaits nor changes the terminal gate,
// response evidence, event seal, or exact cross-stack comparison.
export function createProviderOverlapProfileActionDiagnostic() {
  const requests = new Map();
  const entries = [];
  const milestones = [];
  let phase = null;
  let sequence = 0;
  let invalid = false;
  let truncated = false;
  const observe = (operation) => (...args) => {
    if (invalid) return;
    try {
      operation(...args);
    } catch {
      // A diagnostic failure must never replace an acceptance error.
      invalid = true;
    }
  };
  const event = () => {
    if (!phases.has(phase)) throw new Error("Missing diagnostic phase.");
    return Object.freeze({ sequence: ++sequence, phase });
  };
  const ownedEntry = (request) => {
    if (!request || typeof request !== "object" || types.isProxy(request)) {
      throw new Error("Invalid diagnostic request identity.");
    }
    const entry = requests.get(request);
    if (!entry && !truncated) throw new Error("Unowned diagnostic request identity.");
    return entry;
  };
  return Object.freeze({
    setPhase: observe((value) => {
      if (!phases.has(value)) throw new Error("Unknown diagnostic phase.");
      phase = value;
    }),
    checkpoint: observe((kind) => {
      if (!checkpoints.has(kind) || milestones.some((entry) => entry.kind === kind)
        || (kind === "cabinet-goto-called" && milestones.length !== 1)) {
        throw new Error("Invalid diagnostic checkpoint.");
      }
      milestones.push(Object.freeze({ kind, ...event() }));
    }),
    request: observe((request) => {
      if (!request || typeof request !== "object" || types.isProxy(request)
        || requests.has(request)) throw new Error("Invalid diagnostic request identity.");
      if (entries.length === maximumOccurrences) {
        truncated = true;
        return;
      }
      const entry = { occurrence: entries.length + 1, request: event(), response: null, terminal: null };
      entries.push(entry);
      requests.set(request, entry);
    }),
    response: observe((request) => {
      const entry = ownedEntry(request);
      if (!entry) return;
      if (entry.response || entry.terminal) throw new Error("Duplicate or late diagnostic response.");
      entry.response = event();
    }),
    terminal: observe((request, finished, failureSha256) => {
      const entry = ownedEntry(request);
      if (!entry) return;
      if (entry.terminal || typeof finished !== "boolean"
        || (finished ? failureSha256 !== null
          : typeof failureSha256 !== "string" || !/^[a-f0-9]{64}$/.test(failureSha256))) {
        throw new Error("Invalid diagnostic terminal.");
      }
      entry.terminal = Object.freeze({ ...event(), finished, failureSha256 });
    }),
    snapshot: () => Object.freeze({
      schemaVersion: 1,
      kind: "provider-overlap-profile-action-lifecycle-diagnostic",
      scope: "app-profile-action",
      status: invalid ? "invalid-observation" : "recorded",
      maximumOccurrences,
      truncated,
      // Public Playwright Request identity is not bound to a CDP requestId here.
      // Matching concurrent actions by their shared URL would invent causality.
      cdpCanceled: "unavailable-without-request-identity-binding",
      checkpoints: Object.freeze([...milestones]),
      entries: Object.freeze(entries.map((entry) => Object.freeze({ ...entry }))),
    }),
  });
}
